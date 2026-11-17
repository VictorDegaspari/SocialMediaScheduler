#!/usr/bin/env python3
"""Produce speech captions, with original audio timestamps and no translation."""
import argparse
import json
import os
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--language", default="pt")
    parser.add_argument("--cache-dir", required=True)
    args = parser.parse_args()
    from faster_whisper import WhisperModel

    # Small is a practical multilingual CPU default. The first run downloads
    # the model once into the application's persistent volume.
    model = WhisperModel(
        os.environ.get("CUTS_WHISPER_MODEL", "small"),
        device="cpu",
        compute_type="int8",
        cpu_threads=max(1, min(8, int(os.environ.get("CUTS_CPU_THREADS", "4")))),
        num_workers=1,
        download_root=args.cache_dir,
    )
    segments, _ = model.transcribe(
        args.input,
        task="transcribe",
        language=None if args.language == "auto" else args.language,
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=False,
        hallucination_silence_threshold=1.0,
    )
    cues = []
    for segment in segments:
        # No LLM, initial prompt, subtitle import, normalization or rewriting:
        # these words come directly from recognition of this audio.
        group = []

        def flush():
            if group:
                text = "".join(w.word for w in group).strip()
                if text and group[-1].end > group[0].start:
                    cues.append({
                        "start": round(group[0].start, 3),
                        "end": round(group[-1].end, 3),
                        "text": text,
                        "words": [
                            {"start": round(w.start, 3), "end": round(w.end, 3), "text": w.word.strip()}
                            for w in group
                        ],
                    })
                group.clear()

        for word in segment.words or []:
            if word.end <= word.start or not word.word.strip():
                continue
            if group and (len("".join(w.word for w in group)) + len(word.word) > 44 or word.end - group[0].start > 3.5 or word.start - group[-1].end > 0.7):
                flush()
            group.append(word)
            if word.word.rstrip().endswith((".", "?", "!", "…")):
                flush()
        flush()
    json.dump(cues, sys.stdout, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
