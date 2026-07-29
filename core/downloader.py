from pathlib import Path
import subprocess

DOWNLOAD_FOLDER = Path("downloads")
DOWNLOAD_FOLDER.mkdir(exist_ok=True)

YT_DLP = Path("yt-dlp.exe")


def download_video(url):
    cmd = [
        str(YT_DLP),

        "-f", "bv*[height<=1080]+ba/b[height<=1080]",

        "--merge-output-format", "mp4",

        "-o",
        str(DOWNLOAD_FOLDER / "%(title)s.%(ext)s"),

        url,
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True
    )

    print(result.stdout)
    print(result.stderr)

    if result.returncode != 0:
        raise RuntimeError(result.stderr)

    videos = sorted(
        DOWNLOAD_FOLDER.glob("*.mp4"),
        key=lambda p: p.stat().st_mtime
    )

    if not videos:
        raise RuntimeError("Aucune vidéo téléchargée.")

    return videos[-1]