#!/usr/bin/env python3
"""Transcribe a local audio file or URL with Soniox or Deepgram STT."""

from __future__ import annotations

import argparse
import asyncio
import mimetypes
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from pydub import AudioSegment
from soniox import AsyncSonioxClient
from soniox.types import CreateTranscriptionConfig, TranscriptionTranscript

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from core.keyterm_registry import get_keyterm_registry
from core.stt_factory import (
    DEFAULT_MODELS,
    PROVIDER_DEEPGRAM,
    PROVIDER_SONIOX,
    build_soniox_context,
)

TARGET_SAMPLE_RATE = 16_000
DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen"
MAX_KEYTERMS = 100


def _resolve_provider(explicit: str | None) -> str:
    provider = (explicit or os.getenv("STT_PROVIDER") or PROVIDER_SONIOX).strip().lower()
    if provider in {"seniox", "sonix"}:
        provider = PROVIDER_SONIOX
    if provider not in {PROVIDER_SONIOX, PROVIDER_DEEPGRAM}:
        raise SystemExit(
            f"Unsupported provider '{provider}'. Use '{PROVIDER_SONIOX}' or '{PROVIDER_DEEPGRAM}'."
        )
    return provider


def _resolve_soniox_api_key() -> str:
    api_key = os.getenv("SONIOX_API_KEY") or os.getenv("SENIOX_API_KEY")
    if not api_key:
        raise SystemExit("Set SONIOX_API_KEY (or SENIOX_API_KEY) in the environment.")
    return api_key


def _resolve_deepgram_api_key() -> str:
    api_key = os.getenv("DEEPGRAM_API_KEY")
    if not api_key:
        raise SystemExit("Set DEEPGRAM_API_KEY in the environment.")
    return api_key


def _resolve_soniox_model(model: str | None) -> str:
    return model or os.getenv("SONIOX_STT_ASYNC_MODEL", "stt-async-v5")


def _resolve_deepgram_model(model: str | None) -> str:
    resolved = model or os.getenv("DEEPGRAM_STT_MODEL", DEFAULT_MODELS[PROVIDER_DEEPGRAM])
    if "flux" in resolved.lower():
        print(
            "Deepgram Flux is streaming-only; using nova-3 for file transcription.",
            file=sys.stderr,
        )
        return DEFAULT_MODELS[PROVIDER_DEEPGRAM]
    return resolved


def _normalize_audio(audio_path: Path) -> tuple[Path, Path | None]:
    """Convert audio to 16 kHz mono WAV for provider compatibility."""
    segment = AudioSegment.from_file(audio_path)
    needs_convert = (
        segment.frame_rate != TARGET_SAMPLE_RATE
        or segment.channels != 1
        or segment.sample_width != 2
        or audio_path.suffix.lower() not in {".wav", ".flac"}
    )
    if not needs_convert:
        return audio_path, None

    segment = (
        segment.set_channels(1)
        .set_frame_rate(TARGET_SAMPLE_RATE)
        .set_sample_width(2)
    )
    tmp = Path(tempfile.mkstemp(suffix=".wav")[1])
    segment.export(tmp, format="wav")
    return tmp, tmp


def _speaker_labels(speakers: list[Any]) -> dict[Any, str]:
    """Map provider speaker ids to Agent/Caller for IVR call recordings."""
    labels: dict[Any, str] = {}
    if speakers:
        labels[speakers[0]] = "Agent"
    if len(speakers) > 1:
        labels[speakers[1]] = "Caller"
    for speaker in speakers[2:]:
        labels[speaker] = "Other"
    return labels


def _format_soniox_dialogue(transcript: TranscriptionTranscript) -> str:
    """Format Soniox token stream as alternating Caller/Agent lines."""
    order: list[str] = []
    for token in transcript.tokens:
        speaker = token.speaker
        if speaker and speaker not in order:
            order.append(speaker)

    labels = _speaker_labels(order)
    lines: list[str] = []
    current_speaker: str | None = None
    current_text: list[str] = []

    def flush() -> None:
        if not current_text:
            return
        text = "".join(current_text).strip()
        if not text:
            return
        label = labels.get(current_speaker or "", current_speaker or "Unknown")
        lines.append(f"{label}: {text}")

    for token in transcript.tokens:
        speaker = token.speaker or "unknown"
        if speaker != current_speaker:
            flush()
            current_speaker = speaker
            current_text = [token.text]
        else:
            current_text.append(token.text)

    flush()
    return "\n\n".join(lines)


def _format_deepgram_dialogue(payload: dict[str, Any]) -> str:
    """Format Deepgram utterances as alternating Caller/Agent lines."""
    utterances = payload.get("results", {}).get("utterances") or []
    speakers = sorted({u.get("speaker") for u in utterances if u.get("speaker") is not None})
    labels = _speaker_labels(speakers)

    lines: list[str] = []
    for utterance in utterances:
        text = (utterance.get("transcript") or "").strip()
        if not text:
            continue
        speaker = utterance.get("speaker")
        label = labels.get(speaker, f"Speaker {speaker}")
        lines.append(f"{label}: {text}")
    return "\n\n".join(lines)


def _deepgram_plain_text(payload: dict[str, Any]) -> str:
    channels = payload.get("results", {}).get("channels") or []
    if not channels:
        return ""
    alternatives = channels[0].get("alternatives") or []
    if not alternatives:
        return ""
    return (alternatives[0].get("transcript") or "").strip()


def _content_type(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


async def _load_session_keyterms() -> list[str]:
    registry = await get_keyterm_registry()
    return registry.get_session_keyterms()


def _build_soniox_config(*, keyterms: list[str], dialogue: bool) -> CreateTranscriptionConfig:
    """Match live-call Soniox tuning from stt_factory (plus diarization for files)."""
    return CreateTranscriptionConfig(
        language_hints=["en"],
        language_hints_strict=True,
        enable_language_identification=False,
        enable_speaker_diarization=dialogue,
        context=build_soniox_context(keyterms),
    )


def _build_deepgram_params(*, model: str, keyterms: list[str], dialogue: bool) -> list[tuple[str, str]]:
    """Build Deepgram listen query params, mirroring live-call nova-3 settings."""
    params: list[tuple[str, str]] = [
        ("model", model),
        ("language", "en"),
        ("smart_format", "true"),
    ]
    if dialogue:
        params.extend([("diarize", "true"), ("utterances", "true")])
    for term in keyterms[:MAX_KEYTERMS]:
        if term:
            params.append(("keyterm", str(term)))
    return params


async def _transcribe_soniox(
    *,
    audio_path: Path | None,
    audio_url: str | None,
    model: str,
    normalize: bool,
    dialogue: bool,
    keyterms: list[str],
) -> str:
    client = AsyncSonioxClient(api_key=_resolve_soniox_api_key())
    upload_path = audio_path
    temp_path: Path | None = None
    if audio_path is not None and normalize:
        upload_path, temp_path = _normalize_audio(audio_path)

    try:
        config = _build_soniox_config(keyterms=keyterms, dialogue=dialogue)
        kwargs: dict[str, Any] = {"model": model, "config": config}
        if upload_path is not None:
            kwargs["file"] = str(upload_path)
        elif audio_url is not None:
            kwargs["audio_url"] = audio_url
        else:
            raise ValueError("Provide either audio_path or audio_url")

        transcription = await client.stt.transcribe_and_wait(**kwargs)
        if getattr(transcription, "status", None) == "error":
            err_type = getattr(transcription, "error_type", "unknown")
            err_msg = getattr(transcription, "error_message", "transcription failed")
            raise SystemExit(f"Soniox transcription error ({err_type}): {err_msg}")

        transcript = await client.stt.get_transcript(transcription.id)
        if dialogue:
            return _format_soniox_dialogue(transcript)
        return transcript.text
    finally:
        await client.aclose()
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


async def _transcribe_deepgram(
    *,
    audio_path: Path | None,
    audio_url: str | None,
    model: str,
    normalize: bool,
    dialogue: bool,
    keyterms: list[str],
) -> str:
    upload_path = audio_path
    temp_path: Path | None = None
    if audio_path is not None and normalize:
        upload_path, temp_path = _normalize_audio(audio_path)

    params = _build_deepgram_params(model=model, keyterms=keyterms, dialogue=dialogue)
    headers = {"Authorization": f"Token {_resolve_deepgram_api_key()}"}

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            if audio_url is not None:
                response = await client.post(
                    DEEPGRAM_LISTEN_URL,
                    params=params,
                    headers=headers,
                    json={"url": audio_url},
                )
            elif upload_path is not None:
                response = await client.post(
                    DEEPGRAM_LISTEN_URL,
                    params=params,
                    headers={
                        **headers,
                        "Content-Type": _content_type(upload_path),
                    },
                    content=upload_path.read_bytes(),
                )
            else:
                raise ValueError("Provide either audio_path or audio_url")

        if response.status_code >= 400:
            raise SystemExit(f"Deepgram transcription error ({response.status_code}): {response.text}")

        payload = response.json()
        if dialogue:
            return _format_deepgram_dialogue(payload)
        return _deepgram_plain_text(payload)
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


async def transcribe_audio(
    *,
    provider: str,
    audio_path: Path | None,
    audio_url: str | None,
    model: str | None,
    normalize: bool,
    dialogue: bool,
) -> str:
    keyterms = await _load_session_keyterms()

    if provider == PROVIDER_SONIOX:
        return await _transcribe_soniox(
            audio_path=audio_path,
            audio_url=audio_url,
            model=_resolve_soniox_model(model),
            normalize=normalize,
            dialogue=dialogue,
            keyterms=keyterms,
        )

    return await _transcribe_deepgram(
        audio_path=audio_path,
        audio_url=audio_url,
        model=_resolve_deepgram_model(model),
        normalize=normalize,
        dialogue=dialogue,
        keyterms=keyterms,
    )


def main() -> None:
    load_dotenv(REPO_ROOT / ".env")

    default_provider = _resolve_provider(None)
    parser = argparse.ArgumentParser(
        description="Transcribe audio with Soniox or Deepgram STT",
    )
    parser.add_argument(
        "audio",
        nargs="?",
        type=Path,
        help="Path to local audio file (wav/mp3/m4a/...)",
    )
    parser.add_argument(
        "--url",
        help="Public audio URL to transcribe instead of a local file",
    )
    parser.add_argument(
        "--provider",
        choices=[PROVIDER_SONIOX, PROVIDER_DEEPGRAM],
        default=default_provider,
        help=f"STT provider (default: STT_PROVIDER env or {PROVIDER_SONIOX})",
    )
    parser.add_argument(
        "--model",
        help=(
            "Provider model override. Soniox default: SONIOX_STT_ASYNC_MODEL / stt-async-v5. "
            "Deepgram default: DEEPGRAM_STT_MODEL / nova-3."
        ),
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print provider, model, and keyterm count before transcribing",
    )
    parser.add_argument(
        "--no-normalize",
        action="store_true",
        help="Upload the original file without converting to 16 kHz mono WAV",
    )
    parser.add_argument(
        "--plain",
        action="store_true",
        help="Print one continuous transcript instead of Caller/Agent dialogue",
    )
    args = parser.parse_args()

    if not args.audio and not args.url:
        raise SystemExit("Provide a local audio path or --url")

    if args.audio and not args.audio.is_file():
        raise SystemExit(f"Audio file not found: {args.audio}")

    provider = _resolve_provider(args.provider)
    model = (
        _resolve_soniox_model(args.model)
        if provider == PROVIDER_SONIOX
        else _resolve_deepgram_model(args.model)
    )

    if args.verbose:
        keyterms = asyncio.run(_load_session_keyterms())
        print(
            f"provider={provider} model={model} keyterms={len(keyterms)} "
            f"lang=en diarization={not args.plain}",
            file=sys.stderr,
        )

    text = asyncio.run(
        transcribe_audio(
            provider=provider,
            audio_path=args.audio,
            audio_url=args.url,
            model=args.model,
            normalize=not args.no_normalize,
            dialogue=not args.plain,
        )
    )
    print(text)


if __name__ == "__main__":
    main()
