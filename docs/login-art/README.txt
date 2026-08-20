LANTERN — LOGIN ART PROMPTS
===========================

One .txt per login scene, matching the thirteen canvas scenes in
src/renderer/src/lib/loginScenes.ts (SCENES in lib/loginScene.ts sets the order
and the calendar rules that pick between them).

Each file is self-contained: paste the whole thing into Gemini as a single
image-generation prompt. 00-shared-style.txt is the block every scene file
already ends with — it's split out only so you can edit the house style in one
place and re-paste it into the scene files.

WHAT THE PROMPTS ASSUME
-----------------------
- 16:9, full-bleed behind the whole sign-in screen.
- The sign-in card sits over the LEFT THIRD (it moved left in feature set 196)
  and is translucent with a blur behind it, so nothing in that third should pull
  the eye or the near-white UI text stops reading.
- Style is pinned to the same look as the generated LOOK portraits — see
  STYLE_TAIL in src/renderer/src/lib/lookPortrait.ts. Keep the two in sync if
  you change either, or portraits and background will read as two products.
- Brand accents: periwinkle #6467dc, lantern amber #d07400.

THE NAMES (kept here, never in a prompt)
---------------------------------------
The moons, left to right in 04, are Katamba (grey-violet, thin crescent), Xibar
(blue-white, largest, near full) and Yavash (rose-red, smallest, gibbous). Their
colours and sizes come from the MOONS table in loginScenes.ts.

The mascot is Loomy. The four holiday prompts call him "the mascot" throughout,
for the reason in the section below.

LOOMY
-----
He is PAINTED INTO five images — downpour, harvest, hallows, yule, fireworks —
not drawn over them. Those five prompts describe him in full, in the same place
the canvas currently puts him (about x=0.82, feet at y=0.95, a third of the
frame tall), so the swap doesn't move him.

A pose per scene, since a painted mascot can hold one the canvas can't:

  downpour   bare-headed under a too-big umbrella, content in the rain
  harvest    three-quarter view, looking out over the field (unchanged)
  hallows    arms up in front, hunched, mid-"boo" — trying to be spooky
  yule       cheering, both arms flung overhead, one foot off the ground
  fireworks  seen from behind, head tipped back, one arm waving

Three consequences of painting him in:

- Drop the placeLoomy call in that scene's draw function when you switch it to
  artwork, or you'll get two of him.
- The procedural hats go away. Today one drawing covers every occasion because
  the hats are generated against his head geometry (loginScenes.ts); painted in,
  each holiday needs its own image. That's already the case here — the hat is
  named in each prompt that has one.
- Downpour is NOT a holiday scene, and placeLoomy currently returns early unless
  a holiday hat is set. So the painted downpour has him where the canvas one
  never would. Nothing to change if downpour becomes artwork; but if you ever go
  back to canvas for it, he won't be there.

His canonical description lives in 00-shared-style.txt; the palette's source of
truth is LOOMY_BASE in loginScenes.ts. The two notes that matter most are in
every prompt already: he takes the scene's light and shadow colour rather than
glowing at full saturation, and he casts a contact shadow — without one he
hovers, however well he's drawn.

The other eight scenes have no mascot. If you want him in more of them, the
block in 00-shared-style.txt drops into any prompt — give him a bare head and a
pose that belongs to that place (downpour's umbrella is the model for this), and
loosen that prompt's "no people or faces" negative the way the five have it, or
the two instructions fight.

TWO THINGS THESE PROMPTS DELIBERATELY DO NOT SAY
------------------------------------------------
Both were in the first draft and both produced exactly the artefact they were
trying to avoid, so don't put them back:

- NEVER describe the sign-in card. An earlier draft opened the COMPOSITION
  section with "a translucent dark panel sits over the left third" purely as
  context. The model painted the panel — a darkened ribbon down the left side,
  and in the downpour pass with placeholder lettering inside it. The model has no
  concept of UI it isn't part of; every noun in the prompt is something to draw.
- NEVER ask for the left side to be darker. "Two stops darker on the left" gets
  you a shaded column with a visible edge — the same artefact by another route.
- NEVER name the region either. Dropping the word "panel" wasn't enough: "keep
  the LEFT THIRD of the frame quiet" still produced a ribbon in hallows, because
  a named third of the canvas is a shape, and shapes get painted.
- NEVER put a proper noun in a prompt. The three-moons draft named the moons and
  laid them out as a keyed list; the model wrote the names into the sky as
  labels. Names carry no visual information — the moons are "the leftmost", "the
  middle", "the rightmost", the mascot is "the mascot", and anything a reader
  needs to know by name is in this file instead. Keyed or bulleted layouts are
  worth avoiding for the same reason: a legend invites a diagram.

  What works is positive placement plus a reason inside the scene. Say where the
  subject goes ("the lanterns, the moon and the trees all belong in the middle
  and the right"), then say what the emptier side actually IS in that world
  ("open field running away into fog"), and let the scene's own logic do the
  dimming — the sun is off to the right, the light shafts don't reach that far,
  those trees are distant haze. Every prompt then closes by forbidding zones
  outright: one continuous scene, no band, no column, no side darker than the
  other.

IF A RESULT COMES BACK WRONG
----------------------------
- A band, ribbon or panel down one side: the NEGATIVE section already forbids it;
  repeat that clause verbatim as the last line of the prompt. Check first that
  you haven't reintroduced the word "panel", "card", "UI" — or "left third".
- Too busy on the left: name something dull that lives there instead. "The near
  left is open ground / empty water / bare wall, with nothing standing in it"
  beats any instruction about exposure or emphasis.
- Too bright overall: add "overall exposure is low-key; the brightest value in
  the frame is a small highlight, not a broad area."
- Reads like a photo: strengthen the style line — "painted, visible brushwork,
  no photographic texture or depth-of-field bokeh."
- Loomy has eyes: he will, repeatedly. The four holiday prompts say it twice, in
  the LOOMY block and again in NEGATIVE; if he still gets them, paste "his head
  is blank cloth apart from a single stitched smile" as the final line.
