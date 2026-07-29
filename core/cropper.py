from pathlib import Path
import subprocess

OUTPUT_FOLDER = Path("output")
OUTPUT_FOLDER.mkdir(exist_ok=True)


def crop_vertical(input_file):
    output_file = OUTPUT_FOLDER / f"{input_file.stem}_vertical.mp4"

    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(input_file),

        "-vf",
        "scale=1080:1920:force_original_aspect_ratio=increase,"
        "crop=1080:1920",

        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "20",

        "-c:a", "aac",
        "-b:a", "192k",

        str(output_file)
    ]

    subprocess.run(cmd, check=True)

    return output_file