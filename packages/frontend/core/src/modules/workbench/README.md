# Workbench

```
 ┌─────────────Workbench─────-----──────┐
 |             Browser view            |
 │ ┌───────┐ ┌───────┐ ┌───────┐ ┌──────┤
 │ │header │ │header │ │header │ │      │
 │ │       │ │       │ │       │ │ side │
 │ │       │ │       │ │       │ │ bar  │
 │ │ view  │ │ view  │ │ view  │ │      │
 │ │       │ │       │ │       │ │      │
 │ │       │         │ │       │ │      │
 │ │       │ │       │ │       │ │      │
 │ └───────┘ └───────┘ └───────┘ │      │
 └───────────────────────────────┴──────┘
```

`Workbench` manages browser views in AFFiNE, including the main area and the right sidebar area.

`View` is a managed window under the workbench. Each view has its own history(Support go back and forward) and currently URL.
The view renders the content as defined by the router ([here](../../router.tsx)).
Each route can render its own `Header`, `Body`, and several `Sidebar`s by [ViewIsland](./view/view-islands.tsx).

The `Workbench` manages all Views and decides when to display and close them.
There is always one **active View**, and the URL of the active View is considered the URL of the entire application.

## Sidebar

Each `View` can define its `Sidebar`, which will be displayed in the right area of ​​the screen.
If the same view has multiple sidebars, a switcher will be displayed so that users can switch between multiple sidebars.

> only the sidebar of the currently active view will be displayed.

## Browser navigation and persistence

The browser router owns application navigation. Back and forward navigation is passed to the active view, whose URL is the application URL.

New tabs open browser tabs. Split views can be resized, reordered, and closed inside the workbench, and the right sidebar floats on narrow screens.

Workbench views start from the in-memory default state; native window/tab restoration is not used. Workspace documents, blobs, sync state, and indexes use IndexedDB, including the v1 IndexedDB migration sources. Global preferences and workspace IDs retain their browser local-storage keys.
