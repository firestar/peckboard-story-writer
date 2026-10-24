# Writing lessons update — 2026-10-23 (owner-approved)

Interim text. Source of truth: content/writing-lessons.md in github.com/firestar/visualnovel (to be committed there by card R3-1e). Once it lands, re-vendor docs/writing-lessons.md from it and delete this file.

## Pipeline changes

1. **Model routing.** The owner rejected four passes written by GPT-5.6 Sol ("plain ugly": "I play her message before I can revise that decision."). Default writer model is now Claude Opus 5.5. Lesson: judge any writer model by a pilot chapter the owner plays; switch models when a pilot fails instead of adding more rules. Writer and reviewer models stay plugin settings, default writer = `claude:claude-opus-5-5@acc_00efb018b53b417996c3ec27f7ecc333`.
2. **New required stage per chapter — Cold read (C1).** After each chapter is written (pilot included), the plugin creates a cold-read card for a FRESH reviewer session that receives ONLY the chapter text plus chapters 1..N−1 as a player would see them (no records, synopsis, bible, cards or worker output). It reports every point of confusion (names/terms used before explained, unclear speaker/pronoun, unclear place/time/elapsed time, unexplained motive, anything guessed or re-read, contradictions, and whether after the first 3 lines the reader knows who the narrator is, what they want and what the tension is) plus a list of characters in order of first appearance with what the text had said about them. Then a fix card for the writer fixes every item (C2: confusion is the text's fault) and records item→fix. Only then does the chapter go to the owner gate / review. Show cold-read items and fix status in the dashboard.
3. **Records.** Character records gain "first-introduction scene + exact introduction line"; a per-scene list of unexplained names/terms/rules (C3) that must be answered in time; the review checks every first mention.

## Introduce every character; never assume the reader knows them

Owner: "who is nadia? maybe we need to define our characters and not assume the reader knows who random new characters are." (Nadia first appeared as a name on a voicemail with nothing saying she is the narrator's sister.)

- The first time a character is named, in narration or dialogue, the reader learns in that same line or the next who they are to the lead (relationship or role: "my sister Nadia", "Teo Brandt, my crew chief") plus one thing that makes them matter right now.
- Don't name anyone the reader hasn't met unless the line also says who they are — including names in voicemails, signs, news reports and other characters' dialogue.
- First time on screen: a short physical or behavioural impression in the lead's voice, one or two details, not an inventory.
- Reintroduce briefly after an absence of a chapter or more: who they are and where we last saw them.

## Openings

Owner: "starting a book with 'by the time' sounds dumb."

- The first line of the book and of every chapter must hook: a person, a tension or a question on the page right away.
- Banned openers: "By the time…", waking up, alarms, weather, "It was a … day", time of day as the subject, getting dressed, mirror descriptions, dreams, backstory summaries.
- Open on the lead doing or wanting something that matters, with the situation clear within the first few lines.

## §1D Openings and the reader's point of view

Owner: "always take into account the reader's POV while reading, and do not assume the reader can magic knowledge into existence." Researched (Mythcreants, K.M. Weiland, Jane Friedman, Les Edgerton, TV Tropes).

### Openings

- O1 Open on the main character and one urgent, personal problem you could sum up in a sentence; backstory behind it comes later. (Chris Winkle, Mythcreants, "Planning Your Story's Opening Passages")
- O2 "In medias res" = the middle of a developing situation, not necessarily a fight; never leave the reader unsure who, where or what's going on. (Weiland, "7 Tips for Opening Your Story In Medias Res"; TV Tropes "Lost in Medias Res")
- O3 An opening carries the main character, the tone, a signal of the world, a hint of what's coming, and conflict; know which one you're skipping and why. (Rachel Meyer, Mythcreants, "Five Essentials for an Opening Scene")
- O4 The opening makes a tone promise the book keeps.
- O5 A strong first line gives protagonist + situation + open question (Sanderson, Elantris: "Prince Raoden of Arelon awoke early that morning, completely unaware that he had been damned for all eternity." — the hook is the damnation; the ban on waking openers stands).
- O6 Readers must care who someone is before they care what happens to them; action before that is choreography. (Weiland)
- Owner decision X1: no backstory in the first line or first paragraph; after the hook, two or three lines of backstory are allowed only if what follows depends on them.

### What the reader knows

- K1 The reader knows only what's on the page; confusion comes from too much new information at once, not careless reading. (Winkle, "Seven Ways to Clarify Critical Information")
- K2 Introduce one new element at a time, with room to absorb it. (Becca Puglisi, Mythcreants, "Introducing Otherworldly Elements Without Confusing Readers")
- K3 Show a new term in use rather than defining it up front — but it must be understandable from that context.
- K4 Ask "what does the reader need right now?", not "what do I know?".
- K5 Put important facts where they land: main clause, short sentence, start or end of a paragraph; never buried mid-sentence.
- K6 At most two new names or terms per paragraph; every he/she/it has an obvious owner.
- K7 A name dropped before the reader knows what it refers to is confusion, not characterisation. (Winkle, "Lessons From the Exposition of Crescent City")
- K8 Anything unusual about a character goes in their introduction, not sprung later.
- K9 Signs of the world come through the action, never as a tour.
- K10 Match the rate of new information to how much is new: the stranger the world, the slower and clearer.

### Mystery vs confusion

- M1 In a mystery the reader can put the question into words ("who sent the letter?"); confusion is when they can't form the question. Withhold explanations, never orientation. (Winkle, "The Keys to a Great Opening Scene")
- M2 Present tense has no "little did I know"; hint at what's coming through details the lead notices and can't explain.

### Checking from the reader's side

- C1 Cold-read pass for every chapter (see Pipeline changes 2). (Winkle, "A Complete Guide to Beta Reading": read once, cold, zero priming.)
- C2 When a reader is confused, the text is at fault; fix emphasis or load, don't argue it was "right there".
- C3 Per-scene list of unexplained names, terms and rules; each is a question the reader carries — cap them and answer them in time.

### Don't state the obvious

Added 2026-10-23 (owner). Example the owner flagged: "Nadia only leaves messages when I stop answering, and I let her last two calls ring out."

- Never explain what every adult already knows (phones, voicemail, doors, trains, routines).
- Cut lines whose information follows from the line before or from common sense; where the line carries something that matters, keep the feeling and drop the mechanics.
- Cold read: report such lines as "over-explained / obvious" items, quoting the line; the fix cuts the line or replaces the mechanics with the feeling.

### Visual-novel specific

- V1 The narrator's name and situation come on the first screens, before any other character is named.
- V2 A name plate appearing is itself an introduction: the line just before or after a character's first name plate says who they are to the narrator.

### Stating feelings (owner decision X2)

- Craft sources prefer feelings inferred from action. Our rule stands: narration states what the lead feels and why, in one short line tied to the problem in front of them — never a long inner monologue or backstory dump.
