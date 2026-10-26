# Article context menu

Source specification: [SwipyRSS final right-click and long-press proposal](https://app.notion.com/p/40014cbf629d8131b3cde11c8174516e).

- Active list cards support right-click and a 500ms touch/pen press. The existing pager owns press timing and cancellation at 6px, on additional contacts, cancellation, blur, view changes and paging. Successful presses consume the release click, including on nested controls.
- A body Portal keeps mouse menus at the original click, independently flipping each axis using measured size, visual viewport and safe areas. Touch/pen long presses center the menu near the horizontal contact point, clamped to viewport edges, and prefer 12px above the article card, falling below when needed. If neither side fits, the larger side hosts a scrollable menu; viewport edges keep 12px clearance in addition to safe areas. An oversized card occupying the entire viewport falls back to a viewport-contained menu. Selection holds the existing hover appearance; removing it immediately restores ordinary CSS hover. Reader-return highlighting remains separate.
- Read Above includes the target and all preceding loaded unread rows. It reuses optimistic state updates and rollback without rebuilding the list.
- Mixed scopes show feed metadata and feed actions. Feed bulk read confirms its exact scope, includes unloaded articles and fixes the server timestamp at confirmation. Unread mode invalidates continuations and reloads the current scope; all mode preserves loaded rows and pagination. Successful writes remain visible after refresh failures. Preview mode updates the complete mock collection.
- Expanded side toolbars consume the first context interaction. Outside clicks close without passing through. Menus support Escape and arrow-key navigation; Feed confirmation traps focus.

## Verification

```sh
npm ci
npm run test:platform
npm run test:context-menu
npm run build:site
```

Browser regression (Playwright, local Chromium; no FreshRSS credentials required):

```sh
npx playwright install chromium
npm run dev:web
# In another terminal:
npm run test:context-menu:browser
```

For a system Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable path. To verify a production bundle, serve `dist/` after `build:site` and set `SWIPY_TEST_URL` to that server's root URL. Screenshots go to ignored `work/browser-qa/`, overridable with `SWIPY_TEST_OUTPUT`.

The automated browser scenarios cover all four placements, natural hover restoration, retargeting, outside-click consumption, star state, inclusive Read Above (including previous screens), Feed confirmation/cancellation/navigation, single-feed contents, toolbar priority, all-mode position preservation, reader-return highlighting, actual Chromium touch long press, exact 6px cancellation, multi-touch, pointer cancellation and ordinary taps. Mobile emulation does not replace physical iOS/Android testing. Live FreshRSS write/rollback and partial refresh behavior are tested against controlled service boundaries, without modifying a real account.

## Branch Site

`.openai/hosting.json` binds this branch to its own private Site. `npm run build:site` uses `/` for this Site while preserving the existing `/swipy/` default for other web deployments. GitHub `dev` is not modified by this branch.
