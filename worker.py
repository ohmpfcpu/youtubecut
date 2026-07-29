from PySide6.QtCore import QObject, Signal

from core.downloader import download_video


class DownloadWorker(QObject):

    finished = Signal(str)
    error = Signal(str)
    log = Signal(str)

    def __init__(self, url):
        super().__init__()
        self.url = url

    def run(self):
        try:
            self.log.emit("Téléchargement en cours...")

            video = download_video(self.url)

            self.log.emit("Téléchargement terminé.")

            self.finished.emit(str(video))

        except Exception as e:
            self.error.emit(str(e))