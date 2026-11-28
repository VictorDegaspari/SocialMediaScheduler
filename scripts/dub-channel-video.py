#!/usr/bin/env python3
"""Translate speech for dubbing and synthesize its Brazilian Portuguese audio locally."""
import argparse
import json
import os
from pathlib import Path
import sys
import wave

from dub_portuguese import spoken_portuguese

TRANSLATOR = ("VoragoStudios/gct-m2m100-1.2b-ct2", "d99c594e2558b39d3fafa6f0e5375fa982dbcc3a")
KOKORO = ("ExNihilus/kokoro-onnx", "9f31909e46def1b473b178c9fd330e00801fa1f4")


class DubbingError(Exception):
    pass


def model_file(cache: Path, model: tuple[str, str], filename: str) -> Path:
    from huggingface_hub import hf_hub_download
    from huggingface_hub.errors import LocalEntryNotFoundError

    repo, revision = model
    options = dict(repo_id=repo, revision=revision, cache_dir=cache, token=False, etag_timeout=15)
    try:
        return Path(hf_hub_download(filename=filename, local_files_only=True, **options))
    except LocalEntryNotFoundError:
        try:
            return Path(hf_hub_download(filename=filename, **options))
        except Exception as exc:
            raise DubbingError("model_download") from exc


def translate(language: str, phrases: list[str], cache: Path, threads: int) -> list[str]:
    if language == "pt":
        return phrases

    import ctranslate2
    import sentencepiece

    source_tag = f"__{dict(jw='jv', yue='zh').get(language, language)}__"
    vocabulary = model_file(cache, TRANSLATOR, "shared_vocabulary.json")
    if source_tag not in json.loads(vocabulary.read_text(encoding="utf-8")):
        raise DubbingError("unsupported_language")
    model_file(cache, TRANSLATOR, "config.json")
    tokenizer_path = model_file(cache, TRANSLATOR, "sentencepiece.bpe.model")
    weights = model_file(cache, TRANSLATOR, "model.bin")
    tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(tokenizer_path))
    engine = ctranslate2.Translator(str(weights.parent), device="cpu", compute_type="int8", intra_threads=threads)
    source = [[source_tag, *tokenizer.encode(text, out_type=str), "</s>"] for text in phrases]
    results = engine.translate_batch(source, target_prefix=[["__pt__"] for _ in source],
                                     beam_size=5, max_batch_size=8, max_decoding_length=224,
                                     no_repeat_ngram_size=5)
    translated = [tokenizer.decode(result.hypotheses[0][1:]).strip() for result in results]
    if any(not any(character.isalnum() for character in text) for text in translated):
        raise DubbingError("empty_translation")
    return translated


def synthesize(phrases: list[str], windows: list[float], cache: Path, work: Path, threads: int, profile: str) -> list[float]:
    import numpy as np
    import onnxruntime
    from kokoro_onnx import Kokoro

    weights = model_file(cache, KOKORO, "kokoro-v1.0.onnx")
    profiles = model_file(cache, KOKORO, "voices-v1.0.bin")
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    session = onnxruntime.InferenceSession(str(weights), options, providers=["CPUExecutionProvider"])
    voice = Kokoro.from_session(session, str(profiles))
    durations = []
    for index, (phrase, window) in enumerate(zip(phrases, windows, strict=True)):
        text = spoken_portuguese(phrase)
        samples, rate = voice.create(text, profile, lang="pt-br")
        duration = len(samples) / rate
        if duration > window * 1.08:
            # Keep the model close to its natural speaking rate before final timeline fitting.
            faster, _ = voice.create(text, profile, lang="pt-br", speed=min(1.18, duration / window))
            if 0 < len(faster) < len(samples):
                samples = faster
        if not len(samples):
            raise DubbingError("empty_voice")
        path = work / f"{index}.wav"
        partial = path.with_suffix(".wav.part")
        with wave.open(str(partial), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(rate)
            audio.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
        durations.append(len(samples) / rate)
        partial.replace(path)
    return durations


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--cache-dir", required=True, type=Path)
    args = parser.parse_args()
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    threads = max(1, min(8, int(os.environ.get("CUTS_CPU_THREADS", "4"))))
    request = json.loads(args.input.read_text(encoding="utf-8"))
    try:
        phrases = request["phrases"]
        text = translate(request["language"], [phrase["text"] for phrase in phrases], args.cache_dir, threads)
        durations = synthesize(text, [phrase["window"] for phrase in phrases], args.cache_dir,
                               args.input.parent, threads, request["voice"])
        result = {"durations": durations}
    except DubbingError as error:
        result = {"error": str(error)}
    json.dump(result, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
