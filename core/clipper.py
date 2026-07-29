from pathlib import Path
import subprocess

OUTPUT_FOLDER = Path("output")
OUTPUT_FOLDER.mkdir(exist_ok=True)


def clip_video(input_file, start_ms, end_ms, output_name=None):
    """Découpe une vidéo entre deux marqueurs (en millisecondes)."""

    # Accepte aussi bien un str qu'un Path
    input_file = Path(input_file)

    if end_ms <= start_ms:
        raise ValueError("Le marqueur de fin doit être après le marqueur de début.")

    if output_name is None:
        output_name = f"{input_file.stem}_{start_ms}_{end_ms}.mp4"

    output_file = OUTPUT_FOLDER / output_name

    start_seconds = start_ms / 1000
    duration = (end_ms - start_ms) / 1000

    cmd = [
        "ffmpeg",
        "-y",
        "-ss", str(start_seconds),
        "-i", str(input_file),
        "-t", str(duration),
        "-c", "copy",
        str(output_file),
    ]

    subprocess.run(cmd, check=True)

    return output_file