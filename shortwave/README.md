# Shortwave

A dial, and something under the static.

A procedural shortwave receiver for the AM band, synthesized entirely in this
tab — no recordings, no audio files, no network. Five stations live on the
band, each one built from oscillators, filters, and noise:

- **605 kHz — The Clock.** A station that only knows the time: a tick every
  second, a three-partial chime on the minute, and a low hum underneath.
- **742 kHz — The Weather.** A formant-synthesized voice (sawtooth glottal
  source through a three-band filter bank, phoneme by phoneme) reading a
  looping weather report about a place that does not exist: *light rain,
  moving east, sea calm, sleep well.*
- **951 kHz — The Talkback.** A Morse station. Left alone it sends
  `HOME · SLEEP · LANTERN · SEA`. Type anything and it sends your letters
  back, dot and dash, at 18 wpm.
- **1210 kHz — The Lullaby.** A slow pentatonic drone over brown-noise sea,
  one note every two seconds, for a house that is empty.
- **1503 kHz — The Empty Room.** A faint 402 Hz tone, a single tap every
  seven seconds, and a great deal of silence.

The band breathes on a two-minute day-night cycle. At night the skywave
carries every station stronger and wider, the static thins, and stars come
out on the screen. Passing near a station produces the slow heterodyne
whistle of a receiver sliding across its carrier; lock on and it fades.

- **power** — the radio is off until you say so (the browser demands a
  gesture before it will make sound).
- **tune** — drag the dial, scroll on it, or use the arrow keys (shift for
  one kHz). The needle on the spectrum follows; the s-meter shows what the
  receiver is hearing.
- **volume** — the small knob.
- **type** — letters and spaces go to the talkback station. The transcript
  strip shows what you sent; the amber LED burns while the queue is still
  transmitting.

```bash
python3 -m http.server 8765
```

Then open <http://localhost:8765>. Turn the power on, drag the dial to 951,
and type a word. The station will say it back.
