# Syntaxis

Type an English sentence. Walk through its grammar.

Syntaxis parses a sentence into a dependency tree and builds that tree as a place
you can enter in the browser. Subjects and objects become rooms. The verb decides
the topology of the ground between them. Prepositions are not captions here, they
are geometry: `on` puts the supporting volume underneath you, `under` lifts it
overhead, `through` bores a real opening and runs a tunnel into it, `inside` grows
a container until the figure genuinely fits within it, `around` raises a ring whose
radius is computed from how many members it has to hold.

Live: https://syntaxis.vercel.app

No model is called at any point. The parser, the lexicon and the architecture
grammar are the whole system, which is why a permalink still renders the same
building a year later and why the page works with no key, no backend and no
network after first load.

## Why it is built this way

Prompt-to-3D usually means a language model emitting a list of boxes. The language
is a request and the geometry is a guess, so nothing about the output is accountable
to anything about the input. Syntaxis inverts that. Every volume in the scene traces
to a token, every position traces to a grammatical relation, and the parse readout in
the corner shows the derivation while you stand in it. If the building is wrong, the
grammar is wrong, and you can point at the rule.

The frame is figure and ground, borrowed from cognitive linguistics. In "the lamp
rests on a table" the lamp is the figure and the table is the ground, and it is the
ground that the prepositional phrase supplies. So the builder places the object of
the preposition as a landmark relative to its head, which is why `stack` moves a
volume down: the thing you stand on is beneath you.

## What is in the box

| Piece | Does |
|---|---|
| `src/grammar/lexicon.js` | Closed-class word sets, verb classes, and semantic tables giving nouns a scale, a mass, a material family and a characteristic proportion |
| `src/grammar/parse.js` | Tokeniser, rule-based POS tagger with morphological fallback, dependency tree builder, stable sentence hash |
| `src/grammar/architecture.js` | Dependency tree to spatial plan: topology per verb class, offset and connective geometry per preposition, material per adjective, scene air per adverb |
| `src/world/build.js` | Plan to Three.js: ground displacement per topology, shells you can enter, bored openings built from jambs and a lintel, bridges, shafts, tunnels, rings |
| `src/world/player.js` | One rig for both modes. Desktop carries yaw on the rig and pitch on the camera; in XR the headset writes the camera pose and the same rig is what the thumbstick moves |
| `src/world/agent.js` | The reader. Walks the building in dependency order and names the role of each volume as it arrives |

## The reader

A sentence has a reading order, and the building has a walking order, and Syntaxis
makes them the same order. The reader is a lamp that moves from volume to volume in
dependency order, pausing at each and captioning the grammatical role it is standing
in. Reading the sentence and walking the building are one act.

## Controls

WASD or arrows to walk, mouse to look, Shift to run, Space to rise, Esc to release
the cursor. On a headset, the left thumbstick moves and the right turns.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # grammar and plan assertions
npm run build
```

## Tests

`npm test` asserts the spatial relations are real rather than labelled: that `on`
puts the landmark below the figure, that `under` puts it above, that `through` bores
the volume passed through and not the walker, that `inside` grows a container the
figure actually fits in, that `around` produces a ring wide enough for its members
to stand apart, that each verb class selects a distinct topology and ground profile,
that counts instance volumes, that negation renders as absence, and that one sentence
always produces a byte-identical plan.

The suite was checked by breaking it: inverting the sign of the `stack` offset turns
it red on exactly the assertion that guards it, and restoring the sign turns it green.

## Known limits

The lexicon is finite. A sentence full of proper nouns outside it still builds, but
those nouns fall back to a generic volume. That degradation is printed in the parse
readout as unparsed tokens rather than hidden, so you can always see which words the
grammar understood and which it guessed at.

The tagger is rule-based, not statistical. It handles determiners, adjectives, noun
modifiers, numbers, negation, prepositional attachment and coordination. It does not
handle relative clauses, and a sentence with several clauses builds from the first
main verb with later verbs added as further wings.

WebXR is wired through `renderer.xr` and the standard VR button, and locomotion reads
the controller thumbsticks. It has been exercised on desktop, where the button
correctly reports that the device has no immersive session available. It has not been
run on a headset.

## Licence

MIT.
