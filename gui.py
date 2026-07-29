from PySide6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QListWidget,
    QTextEdit,
    QSlider,
    QAbstractItemView,
)

from PySide6.QtCore import Qt, QThread

from player import VideoPlayer
from worker import DownloadWorker
from project import Project
from core.clipper import clip_video


class MainWindow(QWidget):
    def __init__(self):
        super().__init__()

        self.setWindowTitle("🎬 YouTube Clipper")
        self.resize(1000, 700)

        self.player = VideoPlayer()
        self.project = Project()

        # Signaux du lecteur
        self.player.positionChanged.connect(self.update_position)
        self.player.durationChanged.connect(self.update_duration)

        layout = QVBoxLayout()

        # =========================
        # URL
        # =========================

        layout.addWidget(QLabel("URL YouTube"))

        self.url = QLineEdit()
        layout.addWidget(self.url)

        self.downloadButton = QPushButton("Télécharger")
        layout.addWidget(self.downloadButton)

        # =========================
        # Vidéo
        # =========================

        layout.addWidget(self.player.video_widget)

        # =========================
        # Contrôles vidéo
        # =========================

        controls = QHBoxLayout()

        self.playButton = QPushButton("▶")
        self.pauseButton = QPushButton("⏸")

        controls.addWidget(self.playButton)
        controls.addWidget(self.pauseButton)

        self.timeline = QSlider(Qt.Horizontal)
        self.timeline.setRange(0, 0)

        controls.addWidget(self.timeline)

        self.timeLabel = QLabel("00:00 / 00:00")
        controls.addWidget(self.timeLabel)

        layout.addLayout(controls)

        # =========================
        # Marqueurs
        # =========================

        layout.addWidget(QLabel("Marqueurs"))

        self.markerList = QListWidget()
        self.markerList.setSelectionMode(QAbstractItemView.ExtendedSelection)
        layout.addWidget(self.markerList)

        self.addMarkerButton = QPushButton("📍 Ajouter un marqueur")
        layout.addWidget(self.addMarkerButton)

        self.clipButton = QPushButton("✂ Générer le clip")
        layout.addWidget(self.clipButton)

        # =========================
        # Journal
        # =========================

        layout.addWidget(QLabel("Journal"))

        self.log = QTextEdit()
        self.log.setReadOnly(True)
        layout.addWidget(self.log)

        self.setLayout(layout)

        # =========================
        # Signaux du lecteur
        # =========================

        self.player.mediaLoaded.connect(
            lambda: self.log.append("✅ Média prêt.")
        )

        self.player.errorOccurred.connect(
            lambda txt: self.log.append(f"❌ Lecteur : {txt}")
        )

        # =========================
        # Connexions boutons
        # =========================

        self.playButton.clicked.connect(self.player.play)
        self.pauseButton.clicked.connect(self.player.pause)

        self.downloadButton.clicked.connect(self.download_video)

        self.timeline.sliderMoved.connect(
            self.player.set_position
        )

        self.addMarkerButton.clicked.connect(self.add_marker)
        self.markerList.itemDoubleClicked.connect(self.goto_marker)
        self.clipButton.clicked.connect(self.generate_clip)

    # ======================================================
    # Téléchargement
    # ======================================================

    def download_video(self):

        url = self.url.text().strip()

        if not url:
            self.log.append("❌ Aucune URL.")
            return

        self.downloadButton.setEnabled(False)

        self.thread = QThread()
        self.worker = DownloadWorker(url)

        self.worker.moveToThread(self.thread)

        self.thread.started.connect(self.worker.run)

        self.worker.log.connect(self.log.append)

        self.worker.finished.connect(self.video_downloaded)
        self.worker.error.connect(self.download_error)

        self.worker.finished.connect(self.thread.quit)
        self.worker.error.connect(self.thread.quit)

        self.thread.finished.connect(self.thread.deleteLater)

        self.thread.start()

    # ======================================================
    # Fin téléchargement
    # ======================================================

    def video_downloaded(self, filename):

        self.log.append("🎬 Chargement de la vidéo...")

        self.player.load(filename)
        self.project.video = filename
        self.project.markers.clear()
        self.refresh_markers()
        self.player.play()

        self.log.append("▶ Lecture automatique.")

        self.downloadButton.setEnabled(True)

    def download_error(self, message):

        self.log.append(f"❌ {message}")

        self.downloadButton.setEnabled(True)

    # ======================================================
    # Timeline
    # ======================================================

    def update_position(self, position):

        self.timeline.setValue(position)

        current = position // 1000

        m = current // 60
        s = current % 60

        total = self.player.duration() // 1000

        tm = total // 60
        ts = total % 60

        self.timeLabel.setText(
            f"{m:02}:{s:02} / {tm:02}:{ts:02}"
        )

    def update_duration(self, duration):

        self.timeline.setMaximum(duration)

    # ======================================================
    # Marqueurs
    # ======================================================

    def add_marker(self):
        position = self.player.position()
        if position not in self.project.markers:
            self.project.markers.append(position)
            self.project.markers.sort()
            self.refresh_markers()
            self.log.append(f"📍 Marqueur ajouté à {self.format_time(position)}")

    def refresh_markers(self):
        self.markerList.clear()
        for marker in self.project.markers:
            self.markerList.addItem(f"📍 {self.format_time(marker)}")

    def goto_marker(self, item):
        row = self.markerList.row(item)
        self.player.set_position(self.project.markers[row])

    def format_time(self, ms):
        total = ms // 1000
        return f"{total//60:02}:{total%60:02}"


    def generate_clip(self):

        items=self.markerList.selectedIndexes()

        if len(items)!=2:
            self.log.append("❌ Sélectionnez exactement deux marqueurs.")
            return

        rows=sorted(i.row() for i in items)

        start=self.project.markers[rows[0]]
        end=self.project.markers[rows[1]]

        try:
            output=clip_video(self.project.video,start,end)
            self.log.append(f"✅ Clip créé : {output.name}")
        except Exception as e:
            self.log.append(f"❌ {e}")

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_M:
            self.add_marker()
        else:
            super().keyPressEvent(event)
