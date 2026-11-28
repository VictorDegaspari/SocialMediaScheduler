"""Prepare Brazilian Portuguese text for the dubbing voice."""
from pathlib import Path
import re
import unicodedata

from text2spoken import Form, NormalizationParams, normalize


def read_word_pairs(filename: str) -> dict[str, str]:
    path = Path(__file__).with_name("dubbing") / filename
    with path.open(encoding="utf-8") as words:
        return dict(line.strip().split("=", 1) for line in words if line.strip() and not line.startswith("#"))


VARIANTS = read_word_pairs("variants.txt") | {
    "actualmente": "atualmente", "autocarros": "ônibus",
    "telemóvel": "celular", "telemóveis": "celulares",
    "utilizador": "usuário", "utilizadores": "usuários",
    "funcionou como um charme": "funcionou direitinho", "funciona como um charme": "funciona direitinho",
}
NOUN_PHRASES = {
    "o ecrã": "a tela", "no ecrã": "na tela", "do ecrã": "da tela",
    "a casa de banho": "o banheiro", "à casa de banho": "ao banheiro", "na casa de banho": "no banheiro",
    "a portagem": "o pedágio", "na portagem": "no pedágio",
}
GERUNDS = read_word_pairs("gerunds.txt")
VARIANT_WORDS = re.compile(
    r"\b(?:" + "|".join(map(re.escape, sorted(VARIANTS, key=len, reverse=True))) + r")\b", re.IGNORECASE,
)
# Change the article with the noun only when the phrase ends there.
COMPLETE_NOUN_PHRASES = re.compile(
    r"\b(?:" + "|".join(map(re.escape, NOUN_PHRASES)) + r")(?=\s*(?:[,.!?;:]|$))", re.IGNORECASE,
)
TEAM_NOUN = re.compile(
    r"\b(?:(?:à|às|da|das|na|nas|pela|pelas|uma|umas|nossa|nossas|sua|suas)|(?:com|para|sobre)\s+as?)\s+equipas?\b"
    r"|\bas?\s+equipas?\b(?=\s+(?:é|são|está|estão|estava|estavam|tem|têm|vai|vão)\b)", re.IGNORECASE,
)
PROGRESSIVE = re.compile(
    r"\b(estou|estás|está|estamos|estão|estava|estavas|estavam|estávamos|estive|esteve|estiveram)\s+a\s+"
    r"([^\W\d_]+)\b(?!-)", re.IGNORECASE,
)
SPEECH_FORMS = NormalizationParams().only(
    Form.CARDINAL, Form.ORDINAL, Form.DECIMAL, Form.FRACTION, Form.RANGE, Form.DATE,
    Form.TIME, Form.YEAR, Form.MONEY, Form.MEASURE, Form.PERCENT, Form.ABBREVIATION,
    Form.LETTERS, Form.ROMAN,
)


def adapt_variant(match: re.Match, words: dict[str, str]) -> str:
    source = match[0]
    result = words.get(source.lower(), words.get(source))
    if result is None:
        return source
    if source.isupper():
        return result.upper()
    return result[0].upper() + result[1:] if source[0].isupper() else result


def adapt_progressive(match: re.Match) -> str:
    gerund = GERUNDS.get(match[2].lower())
    return f"{match[1]} {gerund}" if gerund else match[0]


def spoken_portuguese(text: str) -> str:
    text = unicodedata.normalize("NFC", text)
    text = COMPLETE_NOUN_PHRASES.sub(lambda match: adapt_variant(match, NOUN_PHRASES), text)
    text = VARIANT_WORDS.sub(lambda match: adapt_variant(match, VARIANTS), text)
    # Require noun context because a bare "a equipa" can also be a pronoun and a verb.
    text = TEAM_NOUN.sub(lambda match: re.sub(r"equipa(s?)$", r"equipe\1", match[0], flags=re.IGNORECASE), text)
    text = PROGRESSIVE.sub(adapt_progressive, text)
    text = re.sub(r"(?<=[a-zà-ÿ]{2})([.!?])(?=[A-ZÀ-Þ])", r"\1 ", text)
    text = normalize(text, "pt-BR", SPEECH_FORMS)
    # Both the speech normalizer and eSpeak treat UTI as a word.
    text = re.sub(r"\bUTI\b", "u tê i", text)
    text = re.sub(r"(?:—|\s+–\s+)", ", ", text)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = " ".join(text.split()).strip(" ,;:")
    if text and text[-1].isalnum():
        text += "."
    return text
