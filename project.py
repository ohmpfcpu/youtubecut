class Project:

    def __init__(self):
        self.video = None
        self.markers = []

    def add_marker(self, position):
        if position not in self.markers:
            self.markers.append(position)
            self.markers.sort()

    def remove_marker(self, position):
        if position in self.markers:
            self.markers.remove(position)

    def clear(self):
        self.video = None
        self.markers.clear()