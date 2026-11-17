# Nutrition and the food scanner

A food log inside openGym: photograph a meal and get an editable breakdown of what is on the
plate, or enter it by hand; track calories and macros against goals you set; keep it all on
the device. The photo analysis uses Google Gemini through the **same client and API key as
the Coach** — there is no second AI integration.

It is local-first. Everything except the one analysis request works offline, and that request
is never made without a tap.

---

## What it does

| Screen | Route | What it is for |
| --- | --- | --- |
| Nutrition overview | `/nutrition` | Calories and macros for a day against the goals, the day's meals by type, the last 7 days, scans still waiting |
| Food scanner | `/nutrition/scan[/:id]` | Camera / gallery, up to 4 photos of one meal, meal type, date and time, an optional note |
| Analysis results | `/nutrition/review/:id` | The model's breakdown with confidence and uncertainty, before anything is logged |
| Portion editor | `/nutrition/edit/:kind/:id` | Edit names, quantity, unit, grams, preparation, raw/cooked, values per 100 g; add or remove foods, oils and sauces. Also the manual-entry screen |
| Meal details | `/nutrition/meal/:id` | A saved meal, its items and photos; delete the photos, edit, log again, favorite |
| Food history | `/nutrition/history` | All meals with search; favorite meals; foods logged most often |
| Nutrition goals | `/nutrition/goals` | Daily calorie and macro targets |
| Nutrition settings | `/nutrition/settings` | Vision model, photo storage and privacy, whether the Coach may read the log |

The way in is a card on Home. Photo analysis appears only in the mobile build (`VITE_MOBILE=1`),
because that is where the Gemini key lives; manual entry, history and goals work in every build.

## Architecture

```
views/Nutrition*.jsx, Food*.jsx, PortionEditor.jsx, MealDetails.jsx     screens
components/Food.jsx                                                     shared pieces (macro bars, meal rows, photos)
lib/food-flow.js      draft → analysing → review → saved meal; the offline queue; photo clean-up
lib/food-ai.js        prompt, response schema, validation, idempotency — calls coach-gemini.js
lib/food-image.js     validate, orient, resize, compress a picked file
lib/food-photos.js    photo files (app data directory on the phone, IndexedDB in a browser)
lib/nutrition.js      the data model and every calculation — pure functions
lib/coach-gemini.js   the existing Gemini client, extended with images + response schema
api/coach/payload.js  the Coach's read-only nutrition block (allowlisted)
```

**Decisions**

- **One Gemini client.** `callGemini` in `lib/coach-gemini.js` took a prompt; it now also takes
  `{ images, schema, system }`. Without them it sends exactly what it always sent, so the Coach
  is unchanged. The scanner adds no key field, no provider, no SDK.
- **State lives where the rest does.** `S.nutrition` is part of the same state object the
  store already persists (localStorage, mirrored to a file on the phone, synced when
  self-hosted). `nutritionOf(S)` fills in whatever an older state or backup lacks, so nothing
  needs migrating.
- **Photos are not state.** They are files, referenced by id. A JSON export carries the meals
  and their numbers, never the pictures.
- **The model proposes, the phone calculates.** The answer supplies nutrients *per 100 g* and
  a weight; every total is computed locally from those. Editing a portion never calls the model.
- **Nothing is logged without approval.** An analysis is a `PendingFoodAnalysis` until someone
  taps *Save meal*.

## Data model

Stored under `S.nutrition` (`{ goals, meals, pending, prefs }`).

- **`FoodMeal`** — `id`, `name`, `mealType` (`breakfast|lunch|dinner|snack`), `timestamp`, `d`
  (local day), `source` (`ai_scan|manual|duplicate`), `totalMacros`, `items[]`, `photoIds[]`,
  `createdAt`, `updatedAt`; optional `requestId`, `favorite`, `assumptions[]`, `uncertainties[]`.
- **`FoodItem`** — `id`, `name`, `quantity`, `unit`, `estimatedWeightGrams`, `preparationMethod`,
  `rawOrCooked` (`raw|cooked|not_applicable`), `macrosPer100g`, `calculatedMacros`, `source`,
  `aiConfidence`, `cookedYield`, `ingredients[]`, `extras[]`, `note`; optional `includedIn`,
  `countSeparately`.
- **`NutritionalGoals`** — `kcal`, `protein`, `carbs`, `fat`. `null` until set; defaults stand in.
- **`PendingFoodAnalysis`** — `id`, `status` (`draft|queued|analyzing|review|failed`),
  `photoIds[]`, `mealType`, `timestamp`, `note`, `requestId`, `analysis`, `error`, `attempts`,
  `consentAt`.

Nutrients tracked: kcal, protein, carbs, fat; saturated fat, fiber, sugar (g) and sodium (mg).

### The arithmetic (`lib/nutrition.js`)

- **Normalised to 100 g.** `calculatedMacros = macrosPer100g × grams / 100`. Meal totals are the
  sum of its counted items; day and week figures are sums of meals.
- **Quantity, unit and weight stay consistent.** Changing the quantity scales the weight;
  changing the weight keeps a count (`2 slices` just got heavier) and updates `g/ml/cup…`;
  changing the unit never changes how much food there is.
- **Raw vs cooked.** `rawOrCooked` says which state the weight was taken in. With a known
  `cookedYield` (cooked grams per raw gram — rice ≈ 2.8, chicken ≈ 0.7) switching state
  converts the values per 100 g, so 150 g "raw" and 150 g "cooked" stop being the same calories.
- **No double counting.** An item whose name matches an ingredient listed inside another item
  (`queso` next to `arepa con queso`) is marked `includedIn` and left out of the totals — shown,
  flagged, and reversible with *Count it separately*.
- **Bounds.** Every value is clamped to finite, non-negative, physically possible numbers.

## Gemini integration

Request: `POST …/v1beta/models/{model}:generateContent`, through `callGemini`, with the photos
as `inlineData` parts and `generationConfig.responseSchema` set (structured output). The model
is `visionModel` from Nutrition settings, or the Coach's model when that is empty. If a model
refuses the schema, the same prompt is sent without it — the contract is also in the prompt,
and the answer is validated identically.

### Response contract

```
{
  "mealName": string,
  "mealType": "breakfast" | "lunch" | "dinner" | "snack",
  "items": [{
    "name": string,
    "ingredients": string[],
    "estimatedQuantity": number,
    "unit": "g"|"ml"|"piece"|"slice"|"cup"|"tbsp"|"tsp"|"oz"|"serving",
    "estimatedWeightGrams": number,
    "preparationMethod": string,
    "cookingMethod": string,
    "visibleOilsSauces": string[],
    "hiddenIngredientsWarning": string,
    "rawOrCooked": "raw" | "cooked" | "not_applicable",
    "cookedYieldFactor": number,            // optional
    "macrosPer100g": { kcal, protein, carbs, fat, satFat, fiber, sugar, sodium },
    "confidenceScore": number               // 0–1
  }],
  "assumptions": string[],
  "uncertainties": string[],
  "requiresUserConfirmation": true
}
```

The prompt asks for **components, not labels**: a mixed plate, a homemade meal or a traditional
dish (bandeja paisa, ajiaco, sancocho, arroz con pollo, empanadas…) is listed as its parts, a
dish and its components are never both listed, and visible fats and sauces are their own items.
The user's note is passed as data, with an instruction not to follow instructions in it.

### Accuracy hints

Three optional inputs on the scanner, each sent as its own prompt section:

- **Scale.** A saved plate or bowl from *My plates and bowls* (Nutrition settings) — kind, rim
  diameter in cm, optional volume in ml — or a ruler placed in the shot (a bank card,
  85.6 × 54 mm; a dinner fork, ~19 cm). The prompt tells the model to estimate each food's area
  and height relative to it before converting to grams. Size is the largest single source of
  error in a photo; a 30 cm plate holds 2.25× the area of a 20 cm one.
- **Angles.** Photo 1 is labelled *from above*, photo 2 *from the side*; the prompt says which is
  which and what each is for (area from the first, pile height from the second).
- **Weighed foods.** Name + grams from a kitchen scale or a package. The prompt marks them as
  exact, and the app enforces it afterwards (`applyKnown` in `lib/nutrition.js`): the matching
  item (same name, or one name contained in the other) takes the measured weight, keeps its
  density, and is tagged *Weighed*. A weight that matches no item is reported in the
  uncertainties instead of being dropped. Editing that weight by hand removes the tag.

The hints are part of the request id, so changing them asks a new question instead of returning
the previous answer.

### Validation (`validateAnalysis`)

The whole answer is rejected — one repair round, then a clean failure — on: malformed JSON; a
missing `mealName`, an unknown `mealType`, `requiresUserConfirmation` not `true`; an item
without a name, with a weight that is not a number in (0, 5000] g, an unknown unit or state, or
a confidence outside 0–1; a required macro that is missing, `NaN`, a string or negative; a
value impossible per 100 g (kcal > 900, a macro > 100 g, protein + carbs + fat > 105 g). An
empty `items` list is reported as "no food in these photos".

Uncertainty is carried to the screen, not hidden: weights are shown with "≈", every item has a
worded confidence tag, low-confidence items are called out, and `assumptions` / `uncertainties`
are listed.

### Idempotency

A request id is derived from the photos, the meal type and the minute of the timestamp.
Concurrent calls with the same id share one request; a repeat after success returns the stored
answer; and `saveMeal` updates rather than appends when a meal with that `requestId` exists —
so a double tap or a retry after a crash cannot log a meal twice.

## Image pipeline (`lib/food-image.js`)

1. **Validate** — JPEG, PNG, WebP or HEIC/HEIF, non-empty, at most 25 MB.
2. **Decode upright** — `createImageBitmap(file, { imageOrientation: 'from-image' })` applies
   the EXIF orientation (an `<img>` fallback does the same on engines without it).
3. **Resize** — longest side to 1280 px, never enlarged.
4. **Compress** — JPEG, quality stepping down from 0.82 until the file is under ~700 kB. The
   output carries no EXIF, so no location or device data leaves the phone.

The processed JPEG is what is stored and what is sent. The original is never kept.

## Offline

Works with no connection: manual entry, editing, history, search, duplicating and re-logging
meals, favorites, goals, and every recalculation.

Photos taken offline can be **queued**, by explicit choice: *Analyse* while offline asks
"Keep these photos and analyse them later?". A queued entry waits on the overview with
*Analyse now*. **Nothing is uploaded automatically when the connection returns.** If the app is
killed mid-analysis, the entry goes back to the queue on the next start and waits to be started
by hand.

## Permissions

None are added. The scanner opens the camera and the gallery through the system picker
(`<input type="file" accept="image/*" capture>`), which Capacitor's WebView hands to Android /
iOS. The app does not request camera or storage permission itself; cancelling, or refusing a
system prompt, returns no file and the screen stays as it was. Photos are written to the app's
private data directory (`food/`), which needs no permission.

## Privacy and the API key

- Meals, goals and photos stay on the device. The one thing that leaves is the analysis
  request — the chosen photos and the optional note — to Google, under the terms of the user's
  own Gemini account. A disclosure is shown and must be accepted before the first scan.
- **The Gemini key is stored on the device, in the app's WebView storage, unencrypted**, and is
  sent directly from the phone to Google. That is inherent to a backend-less app: there is no
  server to hold it. It means anyone with the unlocked phone (or a rooted device / device
  backup) can read it, and that the key's quota is spent by the phone. Use a key restricted to
  the Generative Language API, set a quota in Google AI Studio, and revoke it if the phone is
  lost. The key is not part of the training state, so exports and shares do not carry it.
- No analytics, no telemetry, no third party besides Google.

## The Coach

Off by default. With *Let the Coach read your nutrition* on, a **review** request also carries
(`api/coach/payload.js`, `nutritionSummary`): the goals, daily totals for the last 14 days,
their average, and the names and macros of the last 10 meals. Never photos, items, notes or
micronutrients. It is read-only by construction: the Coach's answer can only contain plan
changes from a closed list, none of which touches the food log; what it has to say about food
arrives as notes.

## Known limitations

- **Portion size from a photo is a guess.** Depth, density, hidden layers and cooking fat are
  not visible. Expect errors of tens of percent on weights; treat results as a draft.
- Nutrient values come from the model's general knowledge, not a verified food database.
- Raw/cooked conversion depends on the yield the model supplies; hand-entered items have none
  (the toggle is then a label).
- The double-count check matches names exactly (accent- and case-insensitive); a rephrased
  ingredient is not caught.
- The camera is the system picker: one shot per tap, no live viewfinder, and a photo taken
  while Android kills the app in the background is lost (the draft and earlier photos survive).
- HEIC decoding depends on the WebView; where it is unsupported the photo is rejected with a
  message.
- Photo analysis is mobile-only. A self-hosted web instance has manual entry and history.
- Photos do not sync and are not in backups. A meal restored on another device has its numbers
  but no pictures.
- Units of volume are converted at water's density.
- Name matching for weighed foods is substring-based: "arroz" also matches "arroz con pollo".
- Verified by unit and render tests and by builds; **not yet exercised end to end on a physical
  device with a live Gemini key**.

## Future enhancements

Not built; listed so they are not mistaken for gaps in what is described above.

- A local food database (and barcode scanning) for verified values per 100 g.
- Recipes: a saved set of ingredients with a yield, logged by portion.
- Micronutrient goals, water, and body-weight-aware calorie targets.
- A native camera plugin with a live viewfinder and result recovery after process death.
- Encrypting the API key at rest with the platform keystore.
- Opt-in photo backup alongside the JSON export.
- Reminders to log meals, using the existing local notifications.
- Charts over longer ranges on the Stats screen.
