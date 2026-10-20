# Optional Tauri adapter

This directory contains the native RSS adapter, embedded article browser, and Tauri SDK dependencies. The PWA builds and runs without this directory or its dependencies.

The shared app accepts the `AppPlatform` interface from `src/platform/Platform.ts`. Vite selects this adapter through the `@platform` alias only in `tauri` mode; Web and Extension builds select `src/platform/web.ts`. The `@platform/styles.css` alias selects shared styles for the PWA and adds this directory's utility-class sources for native builds.

To reconnect the native app later, restore the root `src-tauri/` project and install the platform toolchains, then run these commands from the repository root:

```sh
npm ci
npm --prefix platforms/tauri ci
npm --prefix platforms/tauri run dev
```

The native commands automatically apply this directory's `tauri.conf.json` as an overlay on the root native project's configuration. Its hooks call `dev:frontend` and `build:frontend` in this package, so the root package needs only PWA commands. The frontend build checks the shared app and native adapter with this directory's TypeScript configuration.

```sh
npm --prefix platforms/tauri run build
```

To work on the native frontend without launching or packaging the Rust app:

```sh
npm --prefix platforms/tauri run dev:frontend
npm --prefix platforms/tauri run build:frontend
```

Native packaging, signing, and device testing are outside the current PWA work. Keep platform-specific SDK calls and views here; shared pages should depend only on the platform interface.
