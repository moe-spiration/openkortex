import type { NoteContent } from "./types";

/*
 * Note bodies from design/reference/WebApp.dc.html (notes(): paras, bullets, todos), as content_md.
 * Timestamped todos become action items (kortex.action_items); a recipe's list stays a Markdown checklist.
 */

export const NOTE_CONTENT: Record<string, NoteContent> = {
  n1: {
    contentMd: "The day starts with mobility and a clear plan. The Q4 architecture sync at 11:00 needs a clean conflict concept for the vault sync.\n\nIn the evening there is time for chapter 3 of the AI engineering book and for the week's meal prep.\n\n## Key points\n\n- Energy 9/10 after 20 minutes of morning mobility\n- Priority 1: sketch the SHA-256 checksum concept\n- Mind dump: the gardener could pre-sort clips by tag group\n",
    cover: "/mock/covers/journal.webp",
    actionItems: [{"id":"n1-a1","text":"Prepare the architecture sync","done":false},{"id":"n1-a2","text":"Mobility session and meal prep","done":false},{"id":"n1-a3","text":"Read chapter 3, Contextual Retrieval","done":false}],
  },
  n2: {
    contentMd: "Agenda for 11:00: conflict handling in the vault sync, the Q4 timeline and Tom's open questions about offline use.\n\nFrom doc 02 (sync specification): every file carries a SHA-256 checksum. If the checksums of device and server differ, a .conflict.md appears next to the original instead of one version being overwritten.\n\n## Key points\n\n- One checksum per file, computed on write\n- Conflict: .conflict.md next to the original, no silent overwrite\n- Open: what happens when two devices rename the same file at once\n",
    cover: "/mock/covers/meeting.webp",
    actionItems: [{"id":"n2-a1","text":"Send the checksum concept (SHA-256) to Tom","done":false,"timestamp":"14:20"},{"id":"n2-a2","text":"Add the .conflict.md failure case to the spec","done":false,"timestamp":"31:05"}],
  },
  n3: {
    contentMd: "Note on chapter 3. The central idea: every chunk gets a short description in front of it that places it in the document before it is embedded.\n\nRelevant for the side project: the gardener could write this description while it processes new clips and put it into the index too.\n\n## Key points\n\n- Context per chunk, created once at indexing time\n- The same description for embeddings and BM25\n- Prompt caching cuts the cost considerably\n",
    cover: "/mock/covers/book.webp",
    actionItems: [{"id":"n3-a1","text":"Review the flashcards for chapter 3","done":false}],
    reader: true,
  },
  n4: {
    contentMd: "Export of Tuesday's Claude Code session. The goal was an MCP server that offers the vault to agents as a knowledge source.\n\nDecision: read access with checksum checks first, write access follows after the conflict concept.\n\n## Key points\n\n- Tools: search_notes, read_note, list_tags\n- Write access only after the sync concept\n- Answers name path and checksum as their source\n",
    cover: "/mock/covers/ribbons.webp",
    actionItems: [{"id":"n4-a1","text":"Copy the tool schema into the spec","done":false}],
  },
  n5: {
    contentMd: "Blend spinach and eggs into a batter, bake it on a tray, spread with cream cheese, add the salmon and roll it up. Serve cold or lukewarm.\n\n## Key points\n\n- Bake for about 15 minutes at 180 °C\n- Keeps for two days in the fridge\n- Fits the meal prep for the long-run week\n\n## Shopping list\n\n- [ ] Spinach, 300 g\n- [ ] Smoked salmon, 200 g\n- [ ] Cream cheese, 150 g\n- [ ] Eggs, 4\n",
    cover: "/mock/covers/salmon.webp",
    actionItems: [],
  },
  n6: {
    contentMd: "Saved from Instagram. Transcription and vision recognised the four drills and stored them as a list.\n\n## Key points\n\n- 90/90 hip rotation, 8 per side\n- Thoracic rotation on all fours\n- Deep squat with weight shifts\n- Couch stretch to finish\n",
    cover: "/mock/covers/runner.webp",
    actionItems: [{"id":"n6-a1","text":"Add the drills to the morning mobility","done":false}],
  },
  n7: {
    contentMd: "Reel on hill sprint technique. The key points are extracted as a list.\n\n## Key points\n\n- Lean slightly forward from the ankles\n- Short, quick steps instead of long strides\n- Drive the arms, keep the shoulders relaxed\n",
    cover: "/mock/covers/hyrox.webp",
    actionItems: [],
  },
  n8: {
    contentMd: "The article describes a pattern where MCP sits as one layer in front of tickets, manuals and log data.\n\nInteresting for the sync meeting: permissions are granted per tool, not per agent.\n\n## Key points\n\n- Tool permissions instead of agent permissions\n- Audit log per call\n- Answers with their sources\n",
    cover: "/mock/covers/car.webp",
    actionItems: [],
  },
  n9: {
    contentMd: "The post compares how companies split platform, integration layer and cloud services between themselves and partners.\n\n## Key points\n\n- Building it yourself ties up capacity and gives control\n- Alliances share the cost and need clear interfaces\n- Buying is fast and creates integration work\n",
    cover: "/mock/covers/skyline.webp",
    actionItems: [],
  },
  n10: {
    contentMd: "Saved checklist for apartment viewings. The points are sorted by urgency.\n\n## Key points\n\n- Check service charges and the reserve fund\n- Ask about planned repairs\n- Energy rating and age of the heating\n",
    cover: "/mock/covers/facade.webp",
    actionItems: [{"id":"n10-a1","text":"Go through the checklist with Sam","done":false}],
  },
  n11: {
    contentMd: "Working note for the strategy course. The goal is a canvas that eliminates, reduces, raises and creates factors.\n\n## Key points\n\n- Eliminate: features nobody uses\n- Create: data access for partners\n- Compare the value curve with three competitors\n",
    cover: "/mock/covers/desk.webp",
    actionItems: [{"id":"n11-a1","text":"Finish the Blue Ocean canvas","done":false}],
  },
  n12: {
    contentMd: "Transcript and chapter marks of the podcast. You continue at 61 percent.\n\n## Key points\n\n- Zone 2 means you can still hold a conversation\n- Two to three sessions per week are enough\n- Do not let the intensity creep up\n",
    cover: "/mock/covers/podcast.webp",
    actionItems: [{"id":"n12-a1","text":"Set the Zone 2 plan for next week","done":false}],
  },
  n13: {
    contentMd: "Idea for the background pipeline. Every clip runs through four steps that can be repeated one by one.\n\n## Key points\n\n- Transcription for audio, vision for images\n- Suggest tags from the six groups\n- Write a context description per chunk\n",
    cover: "/mock/covers/loft.webp",
    actionItems: [],
  },
  n14: {
    contentMd: "Export of a Claude chat. Main result: static instructions first, variable content at the end.\n\n## Key points\n\n- Stable system instruction at the start\n- Document context as its own block\n- The variable user question last\n",
    cover: "/mock/covers/ribbons.webp",
    actionItems: [],
  },
  n15: {
    contentMd: "Minutes of the retro with three actions for the next iteration.\n\n## Key points\n\n- Make dependencies visible in planning\n- Demo slots of 15 minutes\n- Record decisions in the minutes\n",
    cover: "/mock/covers/meeting.webp",
    actionItems: [{"id":"n15-a1","text":"Send the retro results to the delivery team","done":false}],
  },
  n16: {
    contentMd: "Stir the batter, pour it into the tin, bake for 40 minutes.\n\n## Key points\n\n- Almond flour, yoghurt, eggs, baking powder\n- Let it cool overnight\n- Freezes well in slices\n",
    cover: "/mock/covers/salmon.webp",
    actionItems: [],
  },
  n17: {
    contentMd: "Calculation aid for the apartment search, complements the viewing checklist.\n\n## Key points\n\n- Gross yield: annual rent divided by the price\n- Net: subtract running costs and reserves\n- Always include the buying costs\n",
    cover: "/mock/covers/stones.webp",
    actionItems: [],
  },
  n18: {
    contentMd: "PDF from the course material, the highlights are copied into the note.\n\n## Key points\n\n- Settle decision rights early\n- A fixed rhythm for steering and review\n- Make progress visible\n",
    cover: "/mock/covers/skyline.webp",
    actionItems: [],
  },
  n19: {
    contentMd: "Quiet evening after the MCP session. The architecture sync is tomorrow.\n\n## Key points\n\n- Energy 7/10\n- Skipped mobility, went for a walk instead\n- Saved the hill sprint reel\n",
    cover: "/mock/covers/journal.webp",
    actionItems: [],
  },
  n20: {
    contentMd: "First test run over 15 km. The heart rate stays stable, the hills are the bottleneck.\n\n## Key points\n\n- Hills: raise the step rate\n- Take the first gel after 40 minutes\n- The Zone 2 base holds up well\n",
    cover: "/mock/covers/hyrox.webp",
    actionItems: [{"id":"n20-a1","text":"Plan hill sprints twice a week","done":false}],
  },
  n21: {
    contentMd: "Review of week 41 with energy, priorities and lessons.\n\n## Key points\n\n- Three of four priorities done\n- Wednesday without a focus block\n- Wrote the journal every day\n",
    cover: "/mock/covers/journal.webp",
    actionItems: [],
  },
  n22: {
    contentMd: "Minutes of the steering committee with the three decisions and the open points.\n\n## Key points\n\n- Shared integration layer agreed\n- Q1 budget in two weeks\n- Risk: dependency on one vendor\n",
    cover: "/mock/covers/skyline.webp",
    actionItems: [{"id":"n22-a1","text":"Prepare the Q1 budget proposal","done":false,"timestamp":"22:40"}],
  },
  n23: {
    contentMd: "Notes from the meeting with the bank. The terms depend heavily on the deposit and the fixed-rate period.\n\n## Key points\n\n- The deposit share sets the interest rate\n- Compare fixed rates for 10 to 15 years\n- Asked for the document checklist\n",
    cover: "/mock/covers/stones.webp",
    actionItems: [{"id":"n23-a1","text":"Collect the documents","done":false}],
  },
  n24: {
    contentMd: "Chat export with test cases and a rating of the recognition.\n\n## Key points\n\n- Steady camera: high hit rate\n- Fast cuts: exercises are missed\n- A transcript improves the result\n",
    cover: "/mock/covers/ribbons.webp",
    actionItems: [],
  },
  n25: {
    contentMd: "Collection for the next family day out.\n\n## Key points\n\n- Loop walk with a view, about three hours\n- Lunch at the lakeside café\n- Check the weather first\n",
    cover: "/mock/covers/dinner.webp",
    actionItems: [{"id":"n25-a1","text":"Agree on a date","done":false}],
  },
};
