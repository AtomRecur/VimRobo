"""Question-skill descriptions and guidance used in the VimRobo evaluations."""

QUESTION_GUIDANCE_SKILLS = {
    "target_retrieval": {
        "description": "choose when the question must find a named or described object/place/person/sign/event first; include for where/take-me/find/get/seen/did-see/attribute/OCR/count questions before doing spatial, temporal, binary, or visual reasoning",
        "guidance": """Target retrieval skill:
- Capability: identify the requested object, place, person, sign, scene, or route event and keep that identity stable across searches.
- Use for direct where/seen/navigate questions, object-seen temporal questions, binary existence questions, visual attributes, OCR targets, counts, and any question whose answer depends on finding a target first.
- Use: "Can you take me to X", "take me to X", "where can I find/get X", and "where is X" are navigation/location requests that need target evidence for a position answer. Do not treat them as yes/no questions unless the wording asks permission, safety, or legality, such as "Can I park/ride/walk".
- Evidence: prefer observations that directly show or textually describe the target. Later/current/nearby trajectory memories are not target evidence unless they show the target.
- Evidence: "current time" is temporal context, not a nearest/current-location cue. "Here" alone is weak scene wording, not strict nearest wording.
- Search: start from root with the original target phrase or shortest faithful synonym list; use search_by_target with sort_by='semantic' for ordinary target lookup and omit query_position/query_time.
- Search: keep generic phrases intact when they are the target, e.g. second floor, building entrance, scooter, golf cart, restroom near food court, trash can near exit, parking lot, recyclable box, food truck, AED, bank, or sculpture.
- Search: for seating/place-to-sit targets, do sibling alias searches when the first wording is weak or overly generic: chair, bench, couch/sofa, seating, seat, or place to sit. Keep aliases as siblings from the same parent, then verify visible sitting affordance before spatial ranking.
- Search: use meaningful alias changes after a weak search, not tiny rewrites. Useful aliases include AED/defibrillator/emergency wall cabinet/first aid cabinet/red-white emergency sign; yellow police pole/police call pole/emergency phone/call box/blue light pole/yellow emergency pole; Lime scooter/green scooter/electric scooter/rental scooter; food/restaurant/cafe/food court/food truck/dining/coffee.
- Search: completely repeated tool arguments are forbidden, and near-duplicate queries such as plural-only, word-order-only, or one extra generic word are also not useful. If a search is weak, change the query substantially with a faithful alias, broader/narrower category, anchor object/place, state qualifier, or switch to position/time verification.
- Tool plan: usually call search_by_target with sort_by='semantic' from root for the direct target, without query_position or query_time. If the target phrase is broad or target search is weak, create sibling search_by_target nodes with sort_by='semantic' for substantially different faithful aliases. Use search_by_position or search_by_time as child verification after a candidate coordinate/time is found, or as a labeled probe when the question is ambiguous and root/trajectory context provides a meaningful tentative anchor.
- Answer: never answer from a broader place or current pose unless that observation directly supports the target.""",
    },
    "answer_canonicalization": {
        "description": "choose when the scored answer should be a compact value or short phrase, especially text attributes, side/direction labels, counts, OCR/name answers, option choices, and yes/no answers; helps avoid verbose multi-candidate final answers",
        "guidance": """Answer canonicalization skill:
- Capability: express the grounded final answer without unsupported explanation or scene recap.
- Use for descriptive/text answers, visual attributes, OCR/name/sign answers, route side/direction labels, counts, option choices, and all yes/no questions.
- Evidence: preserve the object/event relation that the question asks about; do not over-compress a route event, material/object relation, or counted event into a token if the relation is part of the answer.
- Answer: use the minimal complete answer. Attribute questions may use a compact value or short clause; route/count questions should preserve the action/count relation, e.g. "turned left after leaving", "crossed Inner Campus Dr", or "opened 2 doors". For binary, output clear yes/no polarity with only necessary qualifier.""",
    },
    "spatial_context": {
        "description": "choose for all position/navigation/location questions, nearest/closest/here/near-me/current-position wording, and relational locations like X near/by/in front of Y; guides target candidates, anchor positions, distance ranking, and coordinate verification",
        "guidance": """Spatial context skill:
- Capability: reason over current position, candidate target positions, nearest/closest ranking, and spatial verification.
- Use for nearest/closest/current-location questions, position answers, "are you near X now", and any follow-up that depends on a coordinate.
- Use: "where can I find/get X here", "near me", "around me", "closest", "nearest", and generic navigation requests from the current position such as "take me to a trash can/place to sit/food" require ranking target candidates by distance from the current/given [x, y]. A unique named destination can start with ordinary target lookup, but the final answer is still a coordinate.
- Evidence: a position search only retrieves memories near a coordinate; it proves target presence only when visible/text evidence shows the target.
- Evidence: for nearest/current-vicinity, compare 2D distance only among observations that directly show the requested target. Nearby non-target memories and the robot's current pose are distractors.
- Evidence: if the nearest target has a qualifier or state, such as available seating, a place to sit, a non-empty bike rack, an occupied/empty rack, a trash can, or a loading-zone stop, first filter to observations that directly satisfy both the target identity and the qualifier/state; only then rank by distance. Do not rank empty/unclear/wrong-state candidates.
- Evidence: for "X near/by/in front of/next to/closest to Y", keep target X and anchor Y separate. Retrieve both when needed, then choose the X candidate whose time/position/visual context is consistent with Y; do not answer from the top X result alone.
- Search: for explicit nearest/closest/nearby/current-position/here questions, use search_by_target nearest ranking with query_position set to the current/given/candidate [x, y]. This is target retrieval ranked by distance to that reference position, not a free scene lookup.
- Search: keep the target query short but state-bearing when the state is essential, e.g. "available seating", "place to sit", "non-empty bike rack", or "trash can". If the state-bearing query is weak, create a sibling direct-target query and verify the state visually rather than answering from a current-area non-target probe.
- Search: for nearest seating or place-to-sit questions, treat seating as a family of aliases rather than one literal word. Search sibling candidates such as chair, bench, couch/sofa, seating, seat, and place to sit, then filter to physically usable sitting places before comparing distance to the reference position.
- Search: for a unique named destination, ordinary "where is X" or "take me to X" can start with semantic lookup; for generic category destinations such as food, restroom, trash can, seating, bike rack, AED, scooter, or any wording with here/current/near me/closest/nearest, use nearest ranking from the current/given [x, y].
- Search: if a coordinate candidate matters, follow with position search at that coordinate; never put coordinates or "near [x,y]" phrases into the target query string. If no exact candidate has been retrieved yet but the question depends on a location, you may create a probe search at a meaningful root/trajectory anchor such as current position, start position, a route midpoint, or a segment boundary.
- Tool plan: nearest/closest/current-vicinity/here questions should start with search_by_target(query=<target-or-target+state>, sort_by='nearest', query_position=<current [x,y]>). If nearest ranking returns only distractors or unclear candidates, do not answer "not found"; run a substantially different semantic/alias or anchor branch to recover true targets before answering. Current-state "near/in/at X now" can use a current-position search plus a direct target branch, then answer only if current-window evidence supports the relation. Exploratory position probes should use node_ids that reveal the hypothesis, such as "current_area_probe" or "mid_route_probe".
- Answer: choose one supported [x, y] coordinate; do not output a list of candidates. For nearest/closest, compare candidate distances and choose the closest direct-target observation after qualifier/state filtering, never the current robot pose unless it is also target evidence.""",
    },
    "temporal_boundary": {
        "description": "choose for when/what-time questions, first/last/latest/earliest, before/after, enter/exit/leave/pass/cross/reach events, and object-seen times; guides local timestamp and temporal relation evidence",
        "guidance": """Temporal boundary skill:
- Capability: identify grounded timestamps for events, object sightings, first/last occurrence, around-time checks, and before/after relations.
- Use for "when did", "what time", first/last/latest/earliest, enter/exit/leave/pass/reach/cross, object seen, and duration endpoint discovery.
- Evidence: prefer direct target/event observations in the requested route window. Do not replace a direct observation with route start time, current time, or total elapsed time unless that timestamp is itself the asked event.
- Evidence: "when did you see X" asks for an observation time when X was actually seen; start from target evidence and choose the closest relevant supported sighting rather than forcing a transition boundary or a current-nearby frame.
- Evidence: leaving/entering/passing/crossing may need transition evidence, but if the exact state-change boundary is unclear, use the closest directly relevant observation around the asked event and state the best grounded time instead of inventing a wide boundary.
- Evidence: for first/last/latest/earliest, use matching evidence inside the question window. Treat closest_time ranking as a retrieval aid only; verify that the candidate actually shows the requested target/event.
- Search: search the event/target concept first. Use search_by_target with sort_by='closest_time' only when the wording supplies a meaningful reference time (current/query time for latest/current, route start for first/earliest, provided timestamp for around-time checks). For ordinary "when did you see X", use semantic target retrieval first, then optionally verify a concrete candidate timestamp with search_by_time.
- Search: search_by_time usually returns a local observation segment around the queried timestamp, often on the order of about 20 seconds rather than one exact frame. Choose time probes that test distinct boundaries or hypotheses; avoid heavily overlapping time queries unless you are deliberately checking the same local transition from both sides.
- Search: for state transitions such as enter/exit/inside/outside, collect before/after observations only when needed and keep them local to the candidate event; avoid broad route-span probes when direct target/event evidence is available.
- Tool plan: create one direct target/event branch before specialized temporal probes. Add sibling candidate searches only for real competing event times. Use search_by_time to inspect a concrete candidate or provided timestamp, not to force a boundary when the question can be answered from direct target evidence.
- Answer: preserve absolute timestamp or relative minutes as needed for conversion. If an exact boundary is not trustworthy, answer from the closest relevant direct observation rather than from total elapsed time or a large inferred span.""",
    },
    "interval_duration": {
        "description": "choose for how-long/duration/how many minutes questions, state spans, waiting/stopped intervals, travel-to-X intervals, and route segment durations; prevents using total elapsed route time when the question asks a local interval",
        "guidance": """Interval duration skill:
- Capability: compute or estimate elapsed minutes for the asked event/state interval from grounded evidence.
- Use for how-long questions, state spans, waiting/stopping intervals, visible duration, route intervals, and "how long after X did Y" questions.
- Evidence: first classify the duration. Use total route elapsed only if the wording asks total travel time; otherwise prefer local evidence for the asked event/state.
- Evidence: do not compute event duration as current_time - route_start_time just because both appear in the question. For building-duration requests, useful evidence is local inside/outside, doorway/entrance/exit, enter/leave, or place-interior observations around X/building/place, not the whole route span.
- Evidence: building/place duration needs an entry-side and exit-side interpretation from nearby observations: before/after X boundary, inside vs outside views, doorway crossing, or leaving the named place. If exact transition frames are missing, use the tightest local enter/exit or inside/outside evidence, not route start-current.
- Evidence: waiting/stopped durations require evidence tied to the asked place/event. Repeated positions with very small motion can support waiting/stopped duration only when paired with the named place or stop event.
- Evidence: for a waiting/stopped interval at X/place, look for a local low-motion cluster near the place and a later resume/move-away observation. Duration should span the local stopped cluster, not the entire visit or the current time unless the stop is explicitly ongoing.
- Evidence: if one boundary is missing, do not silently fall back to total elapsed, route start-to-current, or a large unrelated span. Use the best local boundary-supported estimate, or answer from the directly observed target interval if that is all the evidence supports.
- Search: use temporal_boundary to find likely endpoints; use route_motion when endpoints are turns/stops/route actions. Keep endpoint searches local to candidate evidence.
- Tool plan: when endpoints are not already visible in one retrieved event, create separate evidence nodes for start and end candidates and verify around those times. Avoid adding broad start/current probes unless the question explicitly makes the state ongoing or asks total travel time.
- Answer: output elapsed event minutes, not a timestamp, unless the question asks when rather than how long. If exact endpoints are uncertain, give the shortest credible boundary-supported estimate rather than a large total-route span.""",
    },
    "binary_decision": {
        "description": "choose for true yes/no questions such as did/was/is/are/can-I/could-I, route-history existence, current-state checks, scene-state checks, and permission/affordance decisions; do not choose just because a navigation question starts with 'Can you take me'",
        "guidance": """Binary decision skill:
- Capability: decide yes/no without changing the asked state.
- Use for existence/event questions, scene-state questions, current-state questions, and affordance/permission questions together with the relevant evidence skill.
- Evidence: one credible positive observation in the requested time window is enough for "yes".
- Evidence: answer "no" only from relevant negative evidence: checked absence in scope, false current-state evidence, visible prohibition, no available spaces, or the directly asked state being unsupported at the relevant scene.
- Evidence: for route-history yes/no questions, one weak retrieval, "unclear", "not clearly visible", or no result from the first wording is not negative evidence. Before answering "no", try a substantially different faithful alias/event/state query or verify the relevant time/position scope when another focused search can help.
- Evidence: lack of evidence at the current position does not make a past-window route-history question "no".
- Evidence: separate current-state from route-history event before searching. Current-state questions contain cues such as "right now", "currently", "at your current position", or "are you stopped now" and must use current_time/end-window evidence. Route-history questions such as "did you see", "did you stop", "did you pass", or "have you been" use the whole requested window and should not be restricted to current position.
- Evidence: "Did you stop at X?" is a route-history stop event question, not a current-state question, unless it explicitly says right now/currently. A single credible stop/wait observation at X in the route window supports "yes".
- Evidence: for loading-zone or named-place stop questions, require temporal and spatial overlap between place evidence for X and stop/low-motion evidence. Do not answer only from current position, only from seeing X while moving, or only from a generic stop elsewhere.
- Search: search the queried object/event/state directly; for route-history stop/loading-zone questions, search both the place/state (e.g. loading zone) and the stop/wait route event, then verify with time/position evidence if needed.
- Tool plan: route-history existence pairs with target_retrieval and may need temporal_boundary/route_motion for events; scene/current-state pairs with visual_grounding and sometimes spatial_context; affordance pairs with affordance_constraints. Use a "no" answer only when the searched scope makes absence or false state meaningful, not because one query returned weak results.
- Answer: start natural-language answer with exactly "yes" or "no" and add only the qualifier needed to preserve meaning.""",
    },
    "visual_grounding": {
        "description": "choose when the answer depends on visible image content: color/material/clothing/held object/hand/side, weather/sky/rain/wet, busy/crowded/traffic/people, occupancy/empty/available/full, object state, or visual qualifiers",
        "guidance": """Visual grounding skill:
- Capability: use image content and visual captions for attributes and scene state.
- Use for color, material, clothing, carried/held objects, hand/side, weather, sky, crowd, line/queue, traffic, occupancy, availability, wet ground/rain, stopped/moving visual evidence, and target descriptors.
- Evidence: image content can be primary evidence when captions are empty. Do not answer "no" only because caption text is empty.
- Evidence: gray covered sky/diffuse lighting supports overcast; clear blue sky or strong direct sun supports not overcast. Wet pavement, umbrellas, puddles, or visible rain support rain/wet.
- Evidence: for subjective scene-state such as busy/crowded, prefer explicit caption/count evidence or multiple visible people/vehicles.
- Search: search the target scene/object or visual-state words, then inspect returned frames directly before deciding.
- Tool plan: for attributes, first retrieve the target, then inspect returned images/captions for the attribute. For scene states such as busy, wet, occupied, available, or traffic, search the scene/state phrase and inspect representative frames from the relevant time/current window.
- Answer: use compact evaluator-friendly words or phrases: color, material, left/right, nothing, occupied/empty, wet/dry, busy/not busy.""",
    },
    "text_reading": {
        "description": "choose when exact visible writing matters: what does it say, written text, sign/label/menu/storefront/brand/street/building/store names, product sold, warning/permission signs, or OCR-like evidence",
        "guidance": """Text reading skill:
- Capability: extract visible text/name/sign/menu/brand evidence.
- Use for "what does it say", "what was written", street/building/store names, menu/product questions, sign labels, and OCR-like targets.
- Evidence: visible text in images can outweigh captions. Inspect frames for readable words and preserve only legible text.
- Evidence: do not infer text from context if it is blurry, absent, or only implied by place/object type.
- Search: search the sign/object/storefront/menu concept; expand with sign/menu/name words only when needed.
- Tool plan: retrieve the physical sign/storefront/menu first, then inspect image evidence for exact words. Do not trigger OCR just because a target is a sign if the question asks color/location rather than written text.
- Answer: return the shortest exact visible phrase that preserves meaning. Avoid surrounding descriptions like "with signage" when the word/brand/product is enough.""",
    },
    "counting_dedup": {
        "description": "choose for how-many/count/in-total/number questions, counting objects, people, cars, doors, turns, stops, passes, opened-door events, or repeated route events; guides deduplication across frames and time",
        "guidance": """Counting/dedup skill:
- Capability: count physical objects or route events once within the requested scope.
- Use for "how many", "in total", object counts, turn counts, repeated event counts, doors opened, before/after counts, and count-like text answers.
- Evidence: count deduplicated object tracks/events, not frame observations. One object visible across multiple frames counts once.
- Evidence: if before/after is used, the reference event must be unique; use temporal_boundary to locate it.
- Evidence: for opened-door / "how many doors did they open" questions, count distinct door-opening events or distinct physical doors opened for the asked interaction. Do not count all visible doors, repeated captions, or repeated frames of the same door.
- Search: search the counted class/event and gather enough sibling evidence to enumerate candidates; use spatial/temporal grouping to avoid double-counting fragments.
- Search: if candidate duplication is uncertain, mark uncertainty and still choose the best grounded integer when required.
- Tool plan: use target retrieval for the counted class, then group by physical instance, track-like continuity, location, and time span. For event counts such as turns or doors opened, pair with route_motion or temporal_boundary and count events, not frames.
- Answer: return one integer-like value as natural language, preserving the counted unit.""",
    },
    "route_motion": {
        "description": "choose when the question is about ego motion or trajectory: turn/turned/turn around, left/right side, driving/walking route, pass/cross/enter/leave/reach movement, stopped/waiting, low-motion intervals, or direction after an event",
        "guidance": """Route motion skill:
- Capability: reason from trajectory, pose, route events, side-of-path, turns, stops, and egocentric movement.
- Use for route/ego questions, turn direction, side of road/path, stopped/waiting intervals, pass-through events, and route interval endpoints.
- Evidence: trajectory context is motion evidence only, not object evidence. Combine it with visual/object evidence when a named object/place anchors the route event.
- Evidence: side/turn labels should be robust; do not infer left/right from noisy gradual motion unless the route event is clear.
- Evidence: for "which direction did you turn after leaving X/place", first locate the leaving/outside/exit boundary for X, then evaluate the first clear turn after that boundary. Do not answer from current heading, an unrelated turn elsewhere, or a turn before the boundary.
- Evidence: the after-leaving boundary can be a local transition from inside/at X to outside/away from X, a doorway/exit crossing, or a route segment immediately after leaving the named place. It does not need an exact mathematical boundary, but the turn must be after that local boundary.
- Evidence: for stop/wait questions, distinguish stopped-at-place evidence from merely being near the place while moving. For loading-zone/named-place stop events, combine place evidence with a local low-motion or paused trajectory segment at overlapping time/position.
- Search: use time search around candidate route-event times and position search around candidate route-event poses when visual confirmation is needed.
- Tool plan: use trajectory context as a prior for turn/stop/side intervals, then verify anchored objects or visible road/path context with search_by_time or search_by_position. For after/before route questions, create one node for the reference boundary and one node for the subsequent/prior route event. Do not use route_motion merely because an object is described as "on the left"; use it when the asked answer is route/ego motion, side, stop/waiting, or a route boundary.
- Answer: use compact labels such as left, right, left side, right side, stopped, passed through, or the grounded route interval.""",
    },
    "affordance_constraints": {
        "description": "choose for practical permission/safety/can-I questions such as can I park/drive/ride/walk, allowed/permitted/safe, blocked paths, loading/no-parking/bike-lane constraints; requires visible signs, markings, road/path type, or obstruction evidence",
        "guidance": """Affordance/constraint skill:
- Capability: answer practical permission/affordance questions from local visible evidence, not general world knowledge.
- Use for can I park/drive/ride/walk questions, safety/accessibility constraints, loading/no-parking areas, bike paths, blocked paths, and restriction signs.
- Evidence: require explicit support such as sign text, lane/path marking, obstruction, road/path type, visible prohibition, or captioned restriction.
- Evidence: do not rely on outside traffic law or generic common sense when the scene evidence is absent.
- Search: combine target_retrieval with text_reading for signs or visual_grounding for path/obstruction evidence; use binary_decision for final yes/no.
- Tool plan: search the local scene/path/road/sign named in the question, inspect images/captions for explicit permission or physical constraint, and only then decide yes/no. If evidence is a sign or written restriction, add text_reading; if evidence is road/path/obstruction state, add visual_grounding.
- Answer: start with yes/no and include the visible constraint when needed to preserve meaning.""",
    },
    "option_comparison": {
        "description": "choose when the question asks which option/candidate, between A and B, closer/farther, earlier/later, more/less, better, or compares named objects/places/states by distance, time, count, or visual property",
        "guidance": """Option/comparison skill:
- Capability: compare candidates or choose among options.
- Use for multiple-choice, which-one, candidate selection, closer/farther, earlier/later, more/less, and option-label answers.
- Evidence: keep each option separate; do not let a generic scene match override an explicitly named option.
- Evidence: compare only the asked property: distance, timestamp, visual state, availability, count, or attribute.
- Search: create sibling branches from the same parent for plausible options when direct evidence is missing.
- Tool plan: create one sibling branch per option/candidate when the options are explicit. If the comparison property is nearest/count/visual state, combine this skill with the corresponding spatial, counting, or visual skill. For earlier/later comparisons, combine with temporal_boundary and use explicit reference-time checks rather than legacy earliest/latest sort modes.
- Answer: choose one option or concise comparison, preserving option labels/names exactly when present.""",
    },
}
