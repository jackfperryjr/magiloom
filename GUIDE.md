<p align="center">
  <img src="resources/icon.png" width="96" height="96" alt="Magiloom" />
</p>

# Magiloom — Player Guide

Magiloom is a DragonRealms game client for Windows, Mac, and Linux. It connects directly to the DragonRealms servers and gives you a clean, modern window for playing — with live vitals, room info, experience tracking, highlights, and optional Lich scripting support.

---

## Table of Contents

1. [Installation](#installation)
2. [Logging in for the first time](#logging-in-for-the-first-time)
3. [Logging in on future visits](#logging-in-on-future-visits)
4. [The game window](#the-game-window)
5. [Panels](#panels)
6. [Avatars](#avatars)
7. [Command input](#command-input)
8. [Highlights](#highlights)
9. [Settings](#settings)
10. [Lich scripting](#lich-scripting)
11. [Troubleshooting](#troubleshooting)

---

## Installation

1. Go to the [Releases page](../../releases) on GitHub.
2. Download the file for your operating system:
   - **Windows:** `Magiloom-Setup-x.x.x.exe`
   - **Mac:** `Magiloom-x.x.x.dmg`
   - **Linux:** `Magiloom-x.x.x.AppImage`
3. Run the installer. On Windows, you may see a SmartScreen warning that says "Windows protected your PC." Click **More info**, then **Run anyway**. This happens because the app is not yet signed with a paid code-signing certificate — it is safe.
4. Magiloom will open automatically after installation.

---

## Logging in for the first time

When you open Magiloom for the first time, you will see the **Sign in** screen.

1. Enter your **Simutronics account name** (the username you use on the Simutronics website or in other clients like StormFront or Wizard).
2. Enter your **password**.
3. Click **Sign in**.

Magiloom will connect to the Simutronics login servers. If you have access to multiple DragonRealms game instances (e.g. Prime, Platinum, The Fallen), you will be asked to **Choose server**. Select the one you want.

Next, you will see the **Choose character** screen. Click your character's name to enter the game.

Magiloom saves your account name automatically so you don't have to type it every time.

---

## Logging in on future visits

After your first login, Magiloom shows a **Welcome back** screen listing your saved accounts. Click your account name to jump straight to the password screen. Your last-played character will be noted beside your name for reference.

- **+ Add account** — adds a new account to the list
- **⚙ Settings** — opens the settings screen (see [Settings](#settings))

---

## The game window

Once you are in the game, the window has three regions: a **title bar** across the top, the **game column** on the left, and the **panel sidebar** on the right.

```
┌────────────────────────────────────────────────────────┐
│  Magiloom                               update  — ▢ ✕ │  title bar
├─────────────────────────────────────┬──────────────────┤
│  flags · RT · hands (R:/L:)         │  ⊞ Panels       │  top bar
│  Health · Mana · Stamina · Spirit   │                  │  vitals
│                                     │  Room            │
│         Main game output            │  Experience      │  sidebar
│         (scrolling text)            │  Conversation    │  panels
│                                     │  Combat  …       │
├─────────────────────────────────────┤                  │
│  ◍ Charname · Online       ✦   ⚙   │                  │  character bar
│  >  type commands here              │                  │  command bar
└─────────────────────────────────────┴──────────────────┘
```

**Title bar** — The Magiloom name, an **update** button that appears when a new version is ready to install, and the window minimize / maximize / close controls.

**Game column** (left), top to bottom:

- **Top bar** — When connected, shows game status flags (bleeding, stunned, prone, etc.), a roundtime (**RT**) countdown, and what you are holding in each hand (**R:** / **L:**).
- **Vitals bar** — Health, Mana/Concentration, Stamina, and Spirit as compact bars (see [Vitals](#vitals)).
- **Main output** — The scrolling game text: room descriptions, combat, conversation, and system messages.
- **Character bar** — Your avatar, character name, and presence (Online / Idle / Do Not Disturb). Click the avatar to set a picture (see [Avatars](#avatars)); click your name for a menu to change presence or disconnect. To the right are quick buttons for **✦ Highlights** and **⚙ Settings**.
- **Command bar** — Type commands here and press **Enter** to send them.

**Panel sidebar** (right) — Info panels that update automatically as you play. Click **⊞ Panels** to choose which ones to show (see [Panels](#panels)).

---

## Panels

The right sidebar contains collapsible panels that track different types of game information.

### Turning panels on or off

Click the **⊞ Panels** button at the top of the sidebar to open the panel manager. Check or uncheck any panel to show or hide it. Your choices are remembered between sessions.

### Resizing panels

Drag the thin resize handle at the bottom of any panel to make it taller or shorter.

### Collapsing panels

Click the **▾** button in a panel's title bar (or double-click the title bar) to collapse it. Click again to expand.

### Closing a panel

Click the **×** in the panel's title bar. You can re-add it any time via **⊞ Panels**.

---

### Room

Shows your current location: the room name, description, and clickable exits. Click any exit direction (e.g. **north**, **southwest**) to move that way automatically.

---

### Experience

Shows the skills you have recently practiced, along with their rank and learning percentage. Type `exp` in the command bar to load or refresh the list.

Columns: **Skill name** | **Rank** | **% toward next rank** | **Mind state** (e.g. *Perusing*, *Dabbling*, *Attentive*)

---

### Active Spells

Shows the name of the spell you currently have active (if any).

---

### Combat

A scrolling log of recent combat messages — attacks, blocks, critical hits, etc. — separated from the main output so you can review combat history without scrolling up through unrelated text.

---

### Atmosphere

A scrolling log of atmospheric messages — ambient events, weather, NPC movements. Useful for roleplaying or spotting rare events without them being buried in combat text.

---

### Conversation

A scrolling log of speech, whispers, and thoughts (telepathy). All spoken text, party chat, and `thinkto` messages appear here so you can follow conversations even during busy combat. Each speaker's avatar appears beside their lines so you can tell at a glance who is talking — see [Avatars](#avatars).

---

### Inventory

Shows the contents of your inventory. Type `inv` in the command bar to load or refresh it.

---

### Deaths

A scrolling log of recent death announcements — when a character or creature is slain — pulled from the main output so you can keep track of who has fallen.

---

## Avatars

Magiloom gives every character a small avatar that appears beside their speech in the [Conversation](#conversation) panel, so you can tell at a glance who is talking.

### Your avatar

Your own avatar is shown at the **bottom-left of the game window**, next to your character name. Click it to open the avatar editor, where you can:

- **Upload** a picture from your computer (it is cropped to a square).
- **Replace** it with a different picture later.
- **Remove** it.

If you don't set a picture, Magiloom generates a **letter avatar** — your character's initial on a colored background derived from the name. Everyone sees the same avatar for the same name, so characters stay visually distinct even without custom pictures.

### Seeing other players' avatars

Avatars appear automatically in the Conversation panel next to each person's speech, whispers, and thoughts. Players who have uploaded and shared a picture show that picture; everyone else shows their letter avatar.

### Sharing your avatar with others

By default your uploaded picture stays only on your own computer. To let other Magiloom users see it beside your speech, open the avatar editor and tick **Share so other Magiloom users see this avatar**.

A few things to know:

- Sharing is **per character and opt-in** — nothing is uploaded until you tick the box.
- You can only publish an avatar for the character you are **currently signed in as**. The first character to claim a name keeps it.
- Unticking the box (or removing your picture) takes it back down for everyone.
- Shared images are **public** — anyone using Magiloom can see the avatar tied to a character name. Don't upload anything you wouldn't want shared.

---

## Command input

The command bar at the bottom of the screen works like any other DragonRealms client:

- Type a command and press **Enter** to send it.
- Press **↑ Arrow Up** to recall previous commands (command history, up to 100 entries).
- Press **↓ Arrow Down** to move forward through history.

The **R:** and **L:** display in the top bar shows what you are holding in each hand, updated automatically as you pick things up or put them down.

---

## Highlights

Highlights let you color-code text in the main output window. For example, you could highlight your character's name in gold, or make healing messages appear in green.

Open the Highlights editor by clicking **✦ Highlights** in the character bar (bottom-left).

### Adding a highlight

1. Click **+ Add highlight**.
2. Type the word or phrase you want to highlight in the **pattern** field.
3. Click a color swatch to set the text color.
4. Click **Save** (or your changes save automatically as you type).

### Options

Expand a highlight row by clicking **▼** to access extra options:

- **Regular expression** — Use a regex pattern instead of plain text (for advanced users).
- **Bold** — Make matched text bold.
- **Text color** — The color applied to the matched text.
- **Background** — A background color behind the matched text.

### Enabling / disabling

Use the checkbox on the left of each highlight row to turn it on or off without deleting it.

### Deleting a highlight

Click the **×** on the right side of the row.

---

## Settings

Click **⚙ Settings** in the character bar (bottom-left) to open the settings dialog.

### Theme

Choose from several color themes for the game window. Themes change the background color, text colors, accent colors, and how vitals bars look. The preview shows a sample of each theme's colors. Click a theme to select it — it applies immediately.

### Display

- **Font family** — Choose the font used in the main output: Cascadia Code, Fira Code, Consolas, Courier New, or a generic monospace font.
- **Font size** — Drag the slider to adjust the text size (10–18 px).

### Lich

If you use Lich for scripting, set the path to your `lich.rbw` file here (see [Lich scripting](#lich-scripting)). Leave this blank if Magiloom detects Lich automatically.

Click **Save** to apply changes.

---

## Lich scripting

[Lich](https://github.com/elanthia-online/) is a third-party Ruby scripting engine for GemStone and DragonRealms. Magiloom can launch Lich for you after you connect, so your scripts run alongside the game.

### Setup

1. Install Ruby and Lich5 on your computer by following the instructions at the Lich Project website.
2. Open Magiloom's **⚙ Settings** and set the **Lich path** to the full path of your `lich.rbw` file (e.g. `C:\Ruby4Lich5\Lich5\lich.rbw`). If you installed Lich in the default location, Magiloom may detect it automatically.

### Using Lich

If you have set a **Lich path**, Magiloom launches Lich automatically when you enter the game and routes the game connection through it, so your scripts run alongside the game. With no Lich path set, Magiloom connects directly and runs as a standalone client.

Add the **Lich** panel to your sidebar (via **⊞ Panels**) to watch it. A colored status dot shows its state:

- **stopped** — Lich is not running.
- **starting** — Lich is launching and connecting.
- **ready** — Lich is running and your scripts are available.
- **error** — Lich failed to start; check the log lines in the panel for details.

The panel also shows Lich's startup and script output, useful for diagnosing problems.

If you do not use Lich, you can ignore this entirely — Magiloom works fine without it.

---

## Troubleshooting

**Windows shows a virus / SmartScreen warning when I try to install.**
This is expected for unsigned applications. Click **More info**, then **Run anyway**. The installer is safe.

**The vitals bars show 0% or the wrong values.**
Vitals update automatically as the game sends data. If they look wrong right after connecting, type any command (e.g. `health`) to prompt the server to send a fresh update.

**ENC always shows "None" even when I am burdened.**
The server only sends encumbrance text when you type the `enc` command. Type `enc` to refresh it. It does not update automatically when you pick up or drop items.

**Experience panel is empty.**
Type `exp` in the command bar. The server only sends experience data when you ask for it.

**Inventory panel is empty.**
Type `inv` in the command bar.

**I cannot see the DevTools / the app seems stuck.**
Press **F12** to open the developer tools window, which may show error messages useful for troubleshooting.

**Lich fails to start.**
- Confirm the path to `lich.rbw` is correct in **⚙ Settings**.
- Make sure Ruby is installed and working on your computer.
- Add the **Lich** panel to your sidebar (via **⊞ Panels**) and read its output for error details.

**I need to log in with a different account.**
From the Welcome back screen, click **+ Add account**. To remove a saved account, there is currently no in-app delete button — this will be added in a future update.

---

*Magiloom is an unofficial, community-made client. DragonRealms is a product of Simutronics Corp.*
