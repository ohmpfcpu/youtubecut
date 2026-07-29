from PySide6.QtCore import QObject, QUrl, Signal
from PySide6.QtMultimedia import QMediaPlayer, QAudioOutput
from PySide6.QtMultimediaWidgets import QVideoWidget


class VideoPlayer(QObject):

    positionChanged = Signal(int)
    durationChanged = Signal(int)
    mediaLoaded = Signal()
    errorOccurred = Signal(str)

    def __init__(self):
        super().__init__()

        self.video_widget = QVideoWidget()
        self.video_widget.setMinimumHeight(400)

        self.audio = QAudioOutput()
        self.player = QMediaPlayer()

        self.player.setAudioOutput(self.audio)
        self.player.setVideoOutput(self.video_widget)

        # Relais des signaux Qt vers notre classe
        self.player.positionChanged.connect(
            lambda pos: self.positionChanged.emit(pos)
        )

        self.player.durationChanged.connect(
            lambda dur: self.durationChanged.emit(dur)
        )

        self.player.mediaStatusChanged.connect(self._media_status)
        self.player.errorOccurred.connect(self._error)

    # ======================================================
    # Contrôle du lecteur
    # ======================================================

    def load(self, filename):
        self.player.setSource(QUrl.fromLocalFile(filename))

    def play(self):
        self.player.play()

    def pause(self):
        self.player.pause()

    def stop(self):
        self.player.stop()

    # ======================================================
    # Timeline
    # ======================================================

    def set_position(self, position):
        self.player.setPosition(position)

    def position(self):
        return self.player.position()

    def duration(self):
        return self.player.duration()

    # ======================================================
    # Signaux
    # ======================================================

    def _media_status(self, status):
        if status == QMediaPlayer.MediaStatus.LoadedMedia:
            self.mediaLoaded.emit()

    def _error(self, error, text):
        self.errorOccurred.emit(text)