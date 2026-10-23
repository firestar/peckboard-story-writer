# Writing lessons — AI-written visual novels

What we learned rewriting *Red Ascendant* (Oct 2026: DLG-0..8 → RW-0..9 → SG-2/RW2 → LE). Every
rule here came from the owner rejecting a real draft. Use it for any future story work in this
project, and paste the relevant parts into every writing card.

---

## 1. Process lessons

1. **Polishing lines does not fix a story.** DLG-0..8 edited sentences but kept the structure; the
   result was still disjointed. Fix structure first (what happens, why, in what order), then voice,
   then English. Three separate passes, in that order.
2. **Plan the whole story before writing chapters.** A treatment with a causal scene-by-scene
   outline (each scene caused by the one before, ending on what forces the next) is what lets
   chapters be written in parallel without falling apart.
3. **Write and review by whole scene and whole chapter, never line by line.** A line that is fine
   on its own but doesn't connect to the lines around it is wrong. Reviewers read the chapter
   start to finish as a reader, fix, and re-read until a full read finds nothing.
4. **Keep a scene-fact sheet per chapter** before writing: time of day, place, light, who is
   present and where, what each person wants, what the lead carries/wears/injuries, how the scene
   connects in and out. Check every line against it.
5. **Parallel chapter writing always needs a whole-novel review after it**, read once per route,
   to fix seams, repeated beats, voice drift and timeline slips.
6. **Each pass can undo earlier fixes.** RW2 reintroduced sprite ids as speaker names that RW-9 had
   fixed. Give every pass a checklist of past fixes to preserve, and verify them in the review.
7. **Style-guide examples leak into the text.** The v1 guide's sample ending line ("The coffee is
   cold…") and its "concrete detail" examples became the coffee/rosemary/plates filler the owner
   hated. Only put examples in a guide that you want copied.
8. **Never give writers numeric quotas** (short-line percentages, metaphor counts). They pad or chop
   to hit the number.
9. **Quote real bad lines in instructions.** "Make it flow" does nothing; "this line is wrong
   because…" works. Every card should carry the owner's own words and concrete examples.
10. **Model routing: judge by a played pilot, not more rules.** The owner rejected four passes
    written by Codex GPT-5.6 Sol ("plain ugly": "I play her message before I can revise that
    decision."). Judge any writer model by a pilot chapter the owner actually plays, and switch
    models when a pilot fails instead of adding more rules. Default writer is now Claude Opus 5.5
    (`claude:claude-opus-5-5@acc_00efb018b53b417996c3ec27f7ecc333`); writer and reviewer models
    stay plugin settings.
11. **Pilot chapter first, then fan out.** We sent all seven chapters out in parallel three times
    (RW, RW2, LE) and the owner only saw the problems afterwards. Write chapter 1 alone (plus its
    story-memory records), have the owner read and approve it, fold the feedback into this doc and
    the style guide, and only then write the other chapters in parallel.
12. **Cold read every chapter (C1).** Before a chapter reaches the owner gate or review, a fresh
    reviewer session reads only the chapter text plus chapters 1..N−1 as a player would see them —
    no records, synopsis, bible, cards or worker output — and reports every point of confusion plus
    the characters in order of first appearance with what the text said about them. A fix card
    then fixes every item (C2: confusion is the text's fault, not the reader's) and records
    item→fix.
13. **Build the introduction records up front.** Character records carry each character's
    first-introduction scene and exact introduction line; keep a per-scene list of unexplained
    names, terms and rules (C3) and answer each one in time. Every review pass checks every first
    mention.

## 1A. Story memory: characters, knowledge, continuity, setting

The writer must remember everything; the reader may not. Build these records **before the first
sentence** and keep them updated chapter by chapter. Every writing card reads them first and
updates them last.

### Character sheets (before the first sentence)

For every character, defined up front:
- **Personality:** core traits, values, fears, flaws, what they want (overall), how they speak,
  how they behave under pressure.
- **Starting emotional state** and **starting attitude toward every other character** (trust,
  affection, fear, resentment, debt…), with the reason for each.
- **What they know** at the start: about the lead, the world, the secrets.
- **First introduction:** the scene where they first appear on the page, and the exact line that
  introduces them (see 1D, "Introduce every character").

### Per-chapter character state

At the start of every chapter, a sheet for every character who appears or is affected:
- Current emotion and why (what happened to put them there).
- Current attitude toward the lead and toward each other character, and how it has changed since
  the last chapter and why.
- What they want in this chapter, and what they are hiding.
- What they know now — and what they don't know yet.

At the end of every chapter, update the sheet: what changed, which event changed it.

### Attitudes change through interactions and decisions

- Every interaction can move an attitude. A choice the player makes changes how characters feel
  about the lead.
- **Only characters who could know about an action react to it.** Track who witnessed it, who was
  told, and who could have heard about it (and from whom). A character can't be angry about
  something they haven't heard of; when they do hear, show how they found out.
- Branches matter: keep the character state per route/choice where decisions differ, so a later
  chapter's dialogue matches what the player actually did.

### Every sentence has a reason

- Every sentence and word must be justifiable: why is it here, why does this character say it
  now, what does it change. If there's no reason, cut it.
- Dialogue must match the speaker's personality, current emotion, current attitude toward the
  listener, and what they know.

### Continuity across chapters

- The reader may have forgotten something from two chapters back; the writer must not. Check the
  records before using any fact, promise, injury, grudge or relationship.
- Give the reader context when an earlier event matters again: a short, natural reminder in the
  lead's thoughts or in dialogue. **Don't be overly flashbacky** — a sentence or two of reminder,
  not a replayed scene, unless the story genuinely calls for a flashback.

### Chapter recap notes

- At the start of every chapter's notes, keep cliff notes of **all** previous chapters (a short
  paragraph each: what happened, what changed, what is unresolved), per route where they differ.
- Writers read the recap before writing; the reviewer updates it after the chapter is final.

### The setting drives the scene

- Before writing a scene, look at its background art and the character sprites in it. The story
  must be built around that environment: what the place lets characters do, hide behind, use as
  a weapon, run to, be trapped by; what the light, space and objects in the image allow.
- Prose and action must match what the background shows (layout, light, time of day, objects).
  Don't describe things the image contradicts; use what it shows.
- Characters' poses and expressions must fit the moment and their current emotion.

## 1B. Story craft

### Setup and payoff list

- Keep a list of every setup: promise, threat, secret, object, injury, debt, unanswered question.
  For each: where it is planted (chapter/scene), where it pays off, per route.
- Nothing planted is left hanging unless it's deliberately left open for the ending; nothing
  pays off that was never planted. The whole-novel review checks the list.

### Choices with consequences

- Every major choice must change something the player can see later: a character's attitude or
  line, who is alive or present, what is possible, a cost. No fake major choices.
- Small flavour choices (tone, wording) may converge, but each option must still get its own
  distinct prose reaction; never identical text after different options (owner decision C).
- Record each choice's consequences in the setup/payoff list and the character-state sheets.
- Consequences reach only characters who could know (see 1A); show how word reaches them.
- The lead-in must make the stakes of the decision clear before the menu appears.

### Exposition and glossary

- Introduce a world term, rule or faction only when the scene needs it, through action or a
  character who needs the answer. No lore dumps; no explaining what the reader already saw.
- Keep one glossary (names, places, factions, powers, ranks, made-up terms) with spelling,
  meaning and the first scene it appears in. Every writer uses it, so names and terms never drift.

### Point of view

- First person: the lead only knows what she sees, hears, is told or can reasonably infer.
- She can't narrate other characters' thoughts or motives as fact. Show them through what they do
  and say, or her guess, marked as a guess.
- She can't know about events she wasn't at until someone tells her.

### Text and art in sync

- A character's sprite appears when they enter or start speaking and is hidden when they leave;
  no one speaks from off stage unless the text says so.
- The sprite's pose and expression match the line and the character's current emotion; change
  the expression when the emotion changes.
- Prose never contradicts the background (see 1A, "the setting drives the scene"). If the story
  needs a place or pose that has no art, flag it rather than writing around it.

### Text box length and pacing

- One box holds what reads comfortably in one go: about two or three sentences, and it must fit
  the dialogue box without scrolling on desktop or phone.
- Vary rhythm: quiet character scenes between tense ones; don't stack fights back to back without
  a breather, and don't let quiet scenes run on without something at stake.
- Scene length follows what the scene must do: a conversation runs until something changes; a
  fight runs through its phases; a transition is short.

### Escalation and antagonists

- Stakes rise every chapter: more to lose, stronger opposition, harder choices, higher costs.
  Each chapter's climax must be bigger, or more personal, than the last.
- Every antagonist has a clear motive that makes sense from their side, a goal, and a plan the
  reader can follow. They act on their own between scenes and react to what the lead does.
- Antagonists are competent: the lead wins by paying a cost or making a choice, not because the
  opponent got stupid.

## 1C. Craft lessons from established sources

Researched 2026-10-23 (craft books, writing teachers, interactive-fiction designers). Owner-approved.

### Structure

1. **Scene → sequel** (Dwight V. Swain, *Techniques of the Selling Writer*). An action scene runs
   goal → conflict → setback. The reaction scene after it runs reaction → dilemma → decision.
   Don't cut from one setback straight to the next goal; the reader needs the reaction beat.
2. **End scenes on "yes, but" or "no, and".** The character gets what they wanted plus a new
   problem, or fails and things get worse. Never a flat yes or a flat no.
3. **Try-fail cycles.** At least one failed or costly attempt comes before the real win, in every
   conflict, not only fights.
4. **Close threads in nested order, last opened first closed** (Mary Robinette Kowal, MICE
   quotient: Milieu, Inquiry, Character, Event). Threads left open or closed out of order read as
   pointless detail.
5. **Three-act check at chapter level only.** For seven chapters: Ch 1 setup, Ch 2–5
   complications, Ch 6 crisis, Ch 7 climax and resolution. Don't force acts onto single scenes.

### Character

6. **Want vs need** (John Truby, *The Anatomy of Story*). The lead's external want (power,
   survival) collides with her inner need (humanity, her people); the arc is that collision.
7. **Define each main character's lie, wound and ghost before chapter 1** (K.M. Weiland,
   helpingwritersbecomeauthors.com): the false belief, the hurt, and the past event behind it.
   Without them, growth feels arbitrary.
8. **Agency.** Side characters make their own choices that change the plot; they don't only react
   to the lead.
9. **One speech habit per character** (sentence length, a pet word, a level of formality) so voices
   are distinguishable without accents or gimmicks.
10. **Each major relationship gets its own arc** (want, conflict, turn), separate from the main
    plot, or routes feel like the same story in different clothes.

### Dialogue

11. **Attribute with action beats, not tags**, once speakers are established. Bad: `"Get out," she
    said angrily.` Good: `"Get out." She doesn't look up from the blade.` (In the VN the name plate
    shows the speaker, so narration beats replace tags entirely.)
12. **"Said", not "hissed", "growled" or "intoned".** Use an unusual verb only when the verb itself is
    the information.
13. **No "As you know, Bob".** Characters don't tell each other things both already know just to
    inform the reader. Put it in narration, or give them a real reason to say it (dispute, test,
    threat).
14. **Every exchange has two different wants** (one wants comfort, the other wants facts). Dialogue
    delivers conflict, not just information.

### Prose

15. **Cut filter words** (Chuck Palahniuk, "thought verbs"; deep-POV craft): "I see", "I notice",
    "I feel", "I hear", "I realise". Report the perception directly. Bad: "I see her hand shake."
    Good: "Her hand shakes."
16. **Summarise unimportant beats in a line; show only the beats with emotional weight or a
    decision.** Showing every beat in full is a main source of filler.
17. **Purple prose test.** If an adjective or clause can go without losing information, cut it.
    Bad: "the ancient, crumbling, moss-choked stone wall". Good: "the crumbling wall".
18. **Echo-word pass.** No distinctive word or phrase repeated within a page.

### Tension

19. **Micro-tension** (Donald Maass, *The Emotional Craft of Fiction*). Every passage carries a small
    open question (what happens next, what does this mean, is this a lie), even in calm scenes.
20. **Promise → progress → payoff** (Brandon Sanderson). Show visible progress steps between a setup
    and its payoff, spread across chapters. Track them in the setup/payoff list.
21. **Two stakes per chapter:** what the lead personally loses and what the wider world loses.
22. **Cliffhangers end on a question**, or on a reveal that changes the meaning of an earlier
    choice, not just a shock image.

### Fights

23. **Stimulus, then reaction** (Swain's motivation-reaction units). Show the cause before the
    response, in that order. Bad: "I drop, because he swung the blade." Good: "The blade swings.
    I drop." This is the sentence-level unit inside each fight phase.
24. **Clear choreography over clever description:** which body part, which direction, what it
    hit. Avoid metaphor-heavy action.

### Branching and choices

25. **Branch and bottleneck.** Routes split for a stretch, then merge at a shared story beat
    before the next split.
26. **Delayed consequences for big choices.** The weightiest choices pay off 2–3 chapters later (a
    character remembers, a scene opens or closes), not immediately.
27. **Every choice sets a variable that something later reads.** If nothing reads it, cut or merge
    the choice. Audit at every chapter outline.
28. **2–4 options that differ in kind** (approach, value, tone), not degree ("aggressive" vs
    "slightly aggressive").

### Revision

29. **Edit macro to micro, in order:** structure and plot holes → character arcs and consistency →
    scene pacing → line prose → copyedit (Jane Friedman). Never polish prose in scenes that may
    still be cut.
30. **Read dialogue aloud (or use text-to-speech)** on every dialogue pass.
31. **Ask readers targeted questions:** Where were you bored? Where did you guess the twist? Whose
    voice blurred with someone else's? Which fight felt too easy? Where were you confused about
    where people were?

### AI failure modes

32. **Banned AI-tell vocabulary:** tapestry, testament to, delve, a sense of, palpable,
    unwavering, echoed through, whispered through, in the realm of, it's worth noting, boundaries
    of. Strip them on a dedicated pass and list them in every writing prompt.
33. **No restating.** Don't explain an image, metaphor or emotion right after showing it; models
    do this as if unsure the line landed.
34. **Repeated sentence-shape pass:** hunt three-item lists, "Not X. Not Y. Z." constructions, and
    runs of sentences opening with "As", "With" or "I".
35. **Give the model a negative list before it writes** (banned words, filter words, said-bookisms,
    jokes, filler details), not only edits afterwards.
36. **Plan for slow resolution.** Models resolve conflict too fast and too cleanly; every outline
    must include the failed attempt or complication before the resolution beat.

### Owner decisions where research conflicted with our rules

- **A. Subtext:** characters may deflect, change the subject or say less than they mean in
  dialogue, but the lead's narration still tells the reader what she feels and why. Subtext lives
  in dialogue, never in narration.
- **B. No fragments in fights either.** Fight speed comes from short complete sentences ("The
  blade swings. I drop."), not fragments.
- **C. Illusion of choice only for flavour choices**, each with a distinct prose reaction. Every
  major choice changes state that is read later.
- **D. Mixed choice labels:** dialogue choices are quoted lines in the lead's voice
  (`"Then we do this the hard way."`); action and stat choices are short plain actions with the
  stat in brackets (`Stand firm against the call (Will 22)`). See section 5.
- **E. Specific only where it matters:** name things precisely only when they matter to the scene
  (a weapon in use, a clue, a payoff object). Otherwise don't mention them at all. This is not a
  licence for texture details.

## 1D. Introducing characters and the reader's point of view

Owner: "always take into account the reader's POV while reading, and do not assume the reader can
magic knowledge into existence." Researched 2026-10-23 (Mythcreants, K.M. Weiland, Jane Friedman,
Les Edgerton, TV Tropes). Owner-approved.

### Introduce every character

Owner: "who is nadia? maybe we need to define our characters and not assume the reader knows who
random new characters are." (Nadia first appeared as a name on a voicemail with nothing saying she
is the narrator's sister.)

- The first time a character is named, in narration or dialogue, the reader learns in that same
  line or the next who they are to the lead (relationship or role: "my sister Nadia", "Teo Brandt,
  my crew chief") plus one thing that makes them matter right now.
- Don't name anyone the reader hasn't met unless the line also says who they are — including
  names in voicemails, signs, news reports and other characters' dialogue.
- First time on screen: a short physical or behavioural impression in the lead's voice, one or two
  details, not an inventory.
- Reintroduce briefly after an absence of a chapter or more: who they are and where we last saw
  them.

### Openings

Owner: "starting a book with 'by the time' sounds dumb."

- The first line of the book and of every chapter must hook: a person, a tension or a question on
  the page right away.
- Banned openers: "By the time…", waking up, alarms, weather, "It was a … day", time of day as the
  subject, getting dressed, mirror descriptions, dreams, backstory summaries.
- Open on the lead doing or wanting something that matters, with the situation clear within the
  first few lines.

### Opening craft (O1–O6, X1)

- **O1. Open on one urgent problem:** the main character and one urgent, personal problem you
  could sum up in a sentence; backstory behind it comes later. (Chris Winkle, Mythcreants,
  "Planning Your Story's Opening Passages")
- **O2. In medias res means clear, not just mid-action:** the middle of a developing situation,
  not necessarily a fight; never leave the reader unsure who, where or what's going on. (Weiland,
  "7 Tips for Opening Your Story In Medias Res"; TV Tropes "Lost in Medias Res")
- **O3. Five things an opening carries:** the main character, the tone, a signal of the world, a
  hint of what's coming, and conflict; know which one you're skipping and why. (Rachel Meyer,
  Mythcreants, "Five Essentials for an Opening Scene")
- **O4. The tone promise:** the opening makes a tone promise the book keeps.
- **O5. Protagonist + situation + open question:** a strong first line gives all three (Sanderson,
  *Elantris*: "Prince Raoden of Arelon awoke early that morning, completely unaware that he had
  been damned for all eternity." — the hook is the damnation; the ban on waking openers stands).
- **O6. Care before action:** readers must care who someone is before they care what happens to
  them; action before that is choreography. (Weiland)
- **X1. No backstory in the hook (owner decision):** no backstory in the first line or first
  paragraph; after the hook, two or three lines of backstory are allowed only if what follows
  depends on them.

### What the reader knows (K1–K10)

- **K1. Confusion is an information-rate problem:** the reader knows only what's on the page;
  confusion comes from too much new information at once, not careless reading. (Winkle, "Seven
  Ways to Clarify Critical Information")
- **K2. One new element at a time:** give room to absorb it before the next. (Becca Puglisi,
  Mythcreants, "Introducing Otherworldly Elements Without Confusing Readers")
- **K3. Show a term in use:** not defined up front — but it must be understandable from that
  context.
- **K4. Ask what the reader needs:** "what does the reader need right now?", not "what do I know?".
- **K5. Put important facts where they land:** main clause, short sentence, start or end of a
  paragraph; never buried mid-sentence.
- **K6. Two new names or terms per paragraph, max:** every he/she/it needs an obvious owner.
- **K7. A name dropped before its referent is confusion:** not characterisation. (Winkle, "Lessons
  From the Exposition of Crescent City")
- **K8. Anything unusual about a character belongs in their introduction:** not sprung later.
- **K9. Signs of the world come through action:** never as a tour.
- **K10. Match the rate of new information to how much is new:** the stranger the world, the
  slower and clearer.

### Mystery vs confusion (M1–M2)

- **M1. A mystery is a question the reader can put into words:** ("who sent the letter?");
  confusion is when they can't form the question. Withhold explanations, never orientation.
  (Winkle, "The Keys to a Great Opening Scene")
- **M2. Present tense has no "little did I know":** hint at what's coming through details the
  lead notices and can't explain.

### Checking from the reader's side (C1–C3)

- **C1. Cold-read pass for every chapter:** see the pipeline's cold-read stage. (Winkle, "A
  Complete Guide to Beta Reading": read once, cold, zero priming.)
- **C2. When a reader is confused, the text is at fault:** fix emphasis or load, don't argue it
  was "right there".
- **C3. Per-scene list of unexplained names, terms and rules:** each is a question the reader
  carries — cap them and answer them in time.

### Visual-novel specific (V1–V2)

- **V1. Narrator first:** the narrator's name and situation come on the first screens, before any
  other character is named.
- **V2. A name plate is an introduction:** the line just before or after a character's first name
  plate says who they are to the narrator.

### Stating feelings (X2)

- **X2. Narration states feelings briefly (owner decision):** craft sources prefer feelings
  inferred from action. Our rule stands: narration states what the lead feels and why, in one
  short line tied to the problem in front of them — never a long inner monologue or backstory
  dump.

## 2. What went wrong with the first style (v1, rejected as "garbage")

v1 was a minimalist literary ruleset. Each rule caused a visible failure:

| v1 rule | What it produced |
|---|---|
| "Name the material, smell, tool… concrete details" | Random filler: coffee, rosemary, mismatched plates, pickled plums, rabbits |
| "One useful unit per box"; "separate setup from consequence" | One fact per click → disjointed, choppy reading |
| "Let art establish the room"; "leave conclusions unstated"; "no commentary" | Reader never learns *why*; scenes don't connect |
| Max one metaphor per scene | Flat, clinical prose |
| Voice sheets built on jargon ("chainage", "counts under stress") | Dialogue that reads like a radio log |
| "Dry wit", sample quips | AI jokes that read random, dumb and annoying |

## 3. The style that works (v2, owner-approved)

**Voice**
- Commercial urban fantasy, first person **present** tense, in the lead's head.
- The reader always knows what she feels, wants right now and fears; say it outright when it matters.
- Narration explains: something happens, she reacts, the reader learns why it matters. No subtext puzzles.
- Plain modern English; imagery when it makes a moment hit harder. No rationing, no purple stacks.

**Flow**
- Every line follows from the one before it. A new topic needs a reason on the page.
- Narration is paragraphs split across boxes, not one fact per box.
- Every detail must matter. No food, drinks, animals, recipes, weather or trivia unless it moves the plot.
- Each scene opens by orienting the reader (where, how much time has passed, why we're here) and
  ends on what pushes into the next scene.

**Scene logic** — the words must make physical sense
- Track time, light, place, who's present, positions, objects, injuries and clothing; no line may contradict them.
- Every action needs a reason; every change of place needs a transition; nothing happens just to fill a box.
- Owner's examples of failures:
  - "The alarm sounds at four. I stop it twice, then let it sound a third time while the room
    darkens around me." — the room can't get darker as morning comes, and a snoozed alarm isn't
    worth three beats.
  - A "standing in front of the coffee machine" line right after waking up, with no reason to be there.

**Dialogue**
- People talk like people: answer the question asked, push back, get angry, deflect when it hurts.
- Conversations run until something changes between the speakers.
- No jargon as personality. If nobody would say it aloud, cut it.

**Humour: none written.** The AI cannot be funny; attempts come off as random and annoying. No
quips, banter, wacky asides, "funny" details or cute callbacks. Warmth and relief come from
character moments (a sister refusing to let go, a tired laugh after surviving), never punchlines.

**Drama and fights**
- Tension before action: threat, standoff, talking, a reason not to fight, then the fight.
- Fights run in phases. The lead is hurt, loses ground and hits a real low point where the reader
  thinks she'll lose ("will she lose?"); she turns it through a choice or a cost, not luck.
- Never resolve a fight in two or three lines. Pain and fear on the page.
- Clear choreography: where everyone is, what each move does, what changed.

## 4. English quality (why it read "like it was translated")

Target: grammatical, idiomatic, college-level published-novel English. Read each chapter as a
native reader would; fix anything they'd stumble on.

| Problem | Bad (real line) | Fix |
|---|---|---|
| No contractions in dialogue | "I am tracking the Hollow… If you keep moving, I will assume you are helping it." | "I'm tracking the Hollow. Keep moving and I'll assume you're with it." |
| Explanatory tails | "…proving it understands the building better than I do" | State the point once, plainly, or drop it |
| Abstract noun chains | "The Vein makes that power legible"; "the useful result does not change my absent choice" | Concrete subject + active verb |
| Overloaded sentences | Three or four clauses joined by semicolons and "while" | Split, reorder, vary length; must read cleanly aloud first time |
| Stiff, formal speech | Balanced, complete, explanatory sentences from everyone | Shorter, idiomatic, interrupting, answering what was asked |

Other rules: consistent tense (first person present) and spelling (British here); no repeated
words close together; only a character whose voice sheet says so (Vigil) avoids contractions.

### Conciseness

Every word must deliver a specific point. Remove filler.

- Cut words that add nothing: "just", "really", "very", "quite", "somehow", "begin to",
  "start to", "manage to", "seem to", "in order to", "the fact that", "for a moment" (unless
  timing matters), stacked adjectives, and restated conclusions.
- One idea, said once. Don't repeat in narration what dialogue, art or a status line already told
  the reader.
- Prefer the short, exact word over the long, vague phrase.
- This doesn't conflict with "narration explains": give the reason once, in the fewest words that
  carry it. Explaining is fine; padding isn't.

| Bad (real line) | Concise |
|---|---|
| "The Vein finishes its record while my hand still burns. Elin repeats that Dorian and four Hounds are waiting beneath Galvani, and I leave the platform because meeting them there is the only way to keep the fight from reaching everyone I have just found again." | "My hand still burns as I leave the platform. If I don't meet Dorian at Galvani, his Hounds will come for Nadia and Teo instead." |
| "Recognition holds it on the landing for one breath." | "It hesitates." |

### Sentence variety

Mix simple, compound and complex sentences to build a natural rhythm.

- **Simple** (one clause): "The door opens." Use it for impact, shocks and decisions.
- **Compound** (clauses joined by and/but/so): "I reach for the bar, but it's already gone."
  Use it for action and back-and-forth.
- **Complex** (main clause plus a because/when/if/although clause): "When the lamp dies, I hear
  it breathing." Use it for cause, reason and tension.
- We've failed in both directions. v1 was all short fragments, which read choppy and disjointed.
  RW2 was nearly all long "X, and Y because Z" sentences, which read monotonous and stiff. Neither
  pattern should run more than two or three sentences in a row.
- Match rhythm to the moment: shorter sentences as tension and fights peak, longer ones for
  reflection and quiet scenes. Vary how sentences open too, not always "I" + verb.

| Monotone (all complex, same length) | Varied |
|---|---|
| "I step down so it will follow me away from the ward. It follows me down one flight because Oriel's scent holds it. A patient calls above us, and the pulse behind that voice breaks the hold." | "I step down, and it follows me. We make it one flight. Then a patient calls out upstairs, and the Hollow's head snaps towards the sound of her heartbeat." |

### Grammar basics: no fragments, no run-ons

- **No sentence fragments in narration.** Every sentence has a subject and a finite verb and
  expresses a complete thought.
  - Bad: "Alarm. No warning." / "One flight." / "Faster now." / "The door at 7.3."
  - Good: "The alarm goes off without warning." / "We make it one flight."
  - This replaces the older v1/v2 allowance for "deliberate" fragments. For impact, use a short
    simple sentence ("The door opens.") instead.
- **No run-on sentences.** Don't fuse two independent clauses with no punctuation or with only a
  comma (comma splice), and don't chain clause after clause with "and", "while" and semicolons.
  - Bad (comma splice): "The Hollow lunges, I raise the bar."
  - Bad (chain): "I turn the wheel, trap one shoulder between the bars, and step close enough to
    seize its head while its free claws tear through Nadia's coat and across my chest."
  - Fix: split it, or join it properly with a conjunction or subordinate clause. "The Hollow
    lunges, and I raise the bar." / "I turn the wheel and trap its shoulder between the bars. Its
    free claws tear through Nadia's coat and into my chest."
- **Dialogue exception:** people really do speak in fragments ("Yes.", "Forty-eight.", "Not
  tonight."). Short natural replies are allowed in quoted speech only. Run-ons are still wrong
  in dialogue unless the character is panicking and the run-on is deliberate.
- Status/system lines follow their own compact format (section 6).

## 5. Choices

- Two label forms, each used consistently across the whole game (owner decision D):
  - **Dialogue choices:** a quoted line in the lead's voice, e.g. `"Then we do this the hard way."`
  - **Action and stat choices:** a short plain action, stat in brackets, e.g.
    "Stand firm against the call (Will 22)" / "Stand firm against the call (Will 22 · costs 25 Hunger)".
- Same punctuation everywhere, no trailing full stops, no raw stat codes ("WIL 22 · SURGE +25 HUNGER").
- Each option must be meaningfully different, and the lead-in narration must make the decision clear.
- After a choice, show its immediate human consequence before any system bookkeeping.

## 6. System / status window voice (kept from v1, works)

- The Vein speaks as a cold game system: concise, exact, emotionally blank. Reports state and
  consequence; never celebrates, consoles or uses metaphor.
- Sentence case, full words ("Might", not "MGT"); a cost or reward is stated once and not
  repeated in narration.

## 7. Mechanical rules for script rewrites

- Preserve every command and parameter: scene/show/hide (incl. staging scale/position), play/stop,
  effect, `$` variables, `status`, `if`, `jump`, menu conditions, scene ids, choice outcomes.
- Speaker names must be the Character asset name (`Elin`, `Mara`), never a sprite id
  (`spr_elin_voss`) — the name plate shows whatever is written.
- New characters: one-word ids; sprites on the same canvas and foot baseline as the existing cast;
  per-background scale so characters match each background's perspective.
- Check that every jump target exists after any pass that adds, splits or renames scenes.

## 8. Card template for future writing work

Every writing card should include: the owner's own words, the relevant sections of this doc,
3+ real bad lines with why they're wrong, the story-memory records to read first and update last
(character sheets, per-chapter character state and knowledge, chapter recap, setup/payoff list,
glossary), the whole-chapter process (fact sheet + look at each scene's background and sprites →
write scenes → full read → fix → re-read until clean), the mechanical preservation list, and a
follow-up whole-novel review card plus a republish card. Order: pilot chapter → cold read → fix →
owner approval → remaining chapters in parallel (each: write → cold read → fix) → whole-novel
review → republish.
