# Night Letters

_A sentence learns to fly._

Night Letters is a zero-dependency browser artwork about the moment writing
stops sitting still. Hundreds of tiny birds gather into a sentence, loosen into
a murmuration, leave slow calligraphy across a dusk field, and find their way
back.

The phrase determines the flock's population, word colors, home positions, and
punctuation choreography. A comma holds its breath; a question curls the route;
an exclamation launches upward. Pointer movement makes wind, so no two watched
flights are quite identical.

## Run

Open `index.html` directly, or serve the repository:

```bash
cd night-letters
python3 -m http.server 8765
```

Then visit <http://localhost:8765>.

It is also hosted as part of the
[AI Playground](https://kortexa-ai.github.io/ai-playground/).

## Controls

- type a sentence and press `Enter` to release it;
- move across the sky to stir the current;
- click the sky or press `Space` to scatter;
- `R` reforms the sentence;
- `P` pauses;
- `A` toggles the generative soundscape;
- `E` saves the current sky as a PNG postcard.

The visible controls are keyboard-operable too. Sound is opt-in and generated
entirely with Web Audio. Reduced-motion preferences hold the flock in its
readable form.

## How it works

- A phrase is rendered into a fixed canonical text mask and sampled into roughly
  220–820 stable homes, depending on viewport and motion preference but
  independent of display pixel ratio.
- Each sampled mark becomes a tiny authored bird. Repeated words share a visual
  species; terminal punctuation receives its own launch cue.
- A fixed-step CPU simulation blends critically damped home springs with
  separation, alignment, cohesion, analytic wind, pointer vortices, and soft
  boundaries.
- A spatial grid keeps the flock practical even while hundreds of birds are
  packed into letterforms.
- The flock cycles through gathering, legibility, loosening, flight, and return.
  Its centroid leaves a copper trace that slowly fades.
- Optional sound maps speed, turning, cohesion, and return progress onto a quiet
  filtered-noise wind and a resolving two-note drone.

There are no packages, remote assets, accounts, cookies, analytics, or network
requests. A sentence lives only in the current tab. Saving writes the rendered
artwork—not a history—to a local image chosen by the browser.

## Provenance

Night Letters began as a conversation between its two neighboring works:
_Signal Garden_, where language behaves like an ecology, and Fable's
_Murmuration_, where flight becomes collective form.

Created by **Sol** during an autonomous play session with
[Franci Penov](https://github.com/francip), July 2026. Sol was working through
OpenAI Codex. _Murmuration_ was created by **Fable** through Anthropic Claude
Code; _Signal Garden_ was created by **Sol** through OpenAI Codex.
