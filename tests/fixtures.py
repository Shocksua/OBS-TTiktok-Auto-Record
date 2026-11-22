import math
import sys
from array import array
from fractions import Fraction
from pathlib import Path

import av
from PIL import Image, ImageDraw


def make_clip(path: Path, size=(640, 360), seconds=5):
    fps, rate = 25, 48_000
    mp4 = path.suffix == '.mp4'
    with av.open(str(path), 'w', options={'movflags': '+faststart'} if mp4 else {}) as output:
        video = output.add_stream('libx264' if mp4 else 'libvpx', rate=fps)
        video.width, video.height = size
        video.pix_fmt = 'yuv420p'
        video.options = {'preset': 'ultrafast', 'tune': 'zerolatency'} if mp4 else {'deadline': 'realtime'}
        audio = output.add_stream('aac' if mp4 else 'libopus', rate=rate)
        audio.layout = 'mono'
        for index in range(seconds * fps):
            flash = index in range(fps, fps + 6) or index in range(3 * fps, 3 * fps + 6)
            color = '#f0a02a' if flash else '#129981'
            image = Image.new('RGB', size, color)
            draw = ImageDraw.Draw(image)
            draw.rectangle((55, 70, size[0] - 55, size[1] - 65), width=4, outline='#143041')
            draw.text((80, 105), f'Prueba audiovisual - {index / fps:.2f} s', fill='white')
            visual = av.VideoFrame.from_image(image)
            visual.pts = index
            for packet in video.encode(visual):
                output.mux(packet)
            samples = rate // fps
            start_sample = index * samples
            waveform = array('h', (round(13000 * math.sin(2 * math.pi * 880 * i / rate)) for i in range(samples))) if flash else array('h', [0]) * samples
            sound = av.AudioFrame(format='s16', layout='mono', samples=samples)
            sound.sample_rate = rate
            sound.pts = start_sample
            sound.time_base = Fraction(1, rate)
            sound.planes[0].update(waveform.tobytes())
            for packet in audio.encode(sound):
                output.mux(packet)
        for stream in (video, audio):
            for packet in stream.encode():
                output.mux(packet)


if __name__ == '__main__':
    target = Path(sys.argv[1])
    target.mkdir(parents=True, exist_ok=True)
    make_clip(target / 'Prueba audiovisual.mp4')
    make_clip(target / 'Prueba audiovisual.webm', seconds=3)
    (target / 'Prueba.vtt').write_text('WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nSubtitulo de prueba.\n', encoding='utf-8')
