// backend.js
// Smart Timetable — DSA edition with edit / append / delete
// Run: node backend.js

const fs = require("fs");
const readline = require("readline-sync");
const SCHEDULE_FILE = "schedule.json";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// -----------------------------
// Utility + DSA Structures
// -----------------------------

class Event {
  constructor(id, name, dayIndex, start_time, end_time, type = "fixed", depends_on = null) {
    this.id = id; // unique id
    this.name = name;
    this.dayIndex = dayIndex; // 0..6
    this.day = days[dayIndex];
    this.start_time = start_time; // "HH:MM" or "N/A"
    this.end_time = end_time;     // "HH:MM" or "23:59"
    this.type = type; // "fixed" or "deadline" or "dependency"
    this.depends_on = depends_on; // name or id of dependency (string or id)
  }
}

// MinHeap (by dayIndex then start_time if provided)
class MinHeap {
  constructor(arr = []) {
    this.heap = [];
    if (arr && arr.length) {
      arr.forEach(e => this.insert(e));
    }
  }

  _compare(a, b) {
    // deadlines: earliest dayIndex first; if equal, keep original order
    if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
    // if both have start_time in "HH:MM", compare them (else keep a before b)
    if (a.start_time && b.start_time && a.start_time !== "N/A" && b.start_time !== "N/A") {
      return a.start_time.localeCompare(b.start_time);
    }
    return 0;
  }

  insert(event) {
    this.heap.push(event);
    this._bubbleUp(this.heap.length - 1);
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this._compare(this.heap[i], this.heap[parent]) < 0) {
        [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
        i = parent;
      } else break;
    }
  }

  peek() {
    return this.heap.length ? this.heap[0] : null;
  }

  extractMin() {
    if (!this.heap.length) return null;
    const min = this.heap[0];
    const end = this.heap.pop();
    if (this.heap.length) {
      this.heap[0] = end;
      this._sinkDown(0);
    }
    return min;
  }

  _sinkDown(i) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this._compare(this.heap[left], this.heap[smallest]) < 0) smallest = left;
      if (right < n && this._compare(this.heap[right], this.heap[smallest]) < 0) smallest = right;
      if (smallest !== i) {
        [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
        i = smallest;
      } else break;
    }
  }

  size() {
    return this.heap.length;
  }

  // non-destructive sorted list
  asSortedArray() {
    // copy and extract to produce sorted list, leave original untouched
    const copy = new MinHeap(this.heap.slice());
    const out = [];
    while (copy.size()) out.push(copy.extractMin());
    return out;
  }
}

// Graph for dependencies (works with event names or IDs)
class Graph {
  constructor() {
    this.adj = new Map(); // node -> [neighbors]
  }
  addEdge(u, v) {
    if (!this.adj.has(u)) this.adj.set(u, []);
    this.adj.get(u).push(v);
  }
  clear() {
    this.adj.clear();
  }
  // returns boolean whether a cycle exists
  hasCycle() {
    const visited = new Set();
    const stack = new Set();
    const self = this;

    function dfs(node) {
      if (!self.adj.has(node)) return false;
      visited.add(node);
      stack.add(node);
      for (const nb of self.adj.get(node)) {
        if (!visited.has(nb) && dfs(nb)) return true;
        if (stack.has(nb)) return true;
      }
      stack.delete(node);
      return false;
    }

    for (const node of this.adj.keys()) {
      if (!visited.has(node) && dfs(node)) return true;
    }
    return false;
  }
}

// -----------------------------
// File IO helpers
// -----------------------------

function loadSchedule() {
  if (!fs.existsSync(SCHEDULE_FILE)) return [];
  try {
    const raw = fs.readFileSync(SCHEDULE_FILE, "utf8");
    const arr = JSON.parse(raw);
    return arr;
  } catch (err) {
    console.error("Failed to read schedule.json:", err);
    return [];
  }
}

function saveSchedule(arr) {
  try {
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(arr, null, 2));
  } catch (err) {
    console.error("Failed to write schedule.json:", err);
  }
}

// -----------------------------
// Helpers: id, format, insertion
// -----------------------------
function generateId() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function padTimeHHMM(s) {
  if (!s) return "N/A";
  if (s === "N/A") return "N/A";
  // accept "9:5" or "0905" etc; convert to "HH:MM"
  if (s.includes(":")) {
    let [h, m] = s.split(":").map(x => x.trim());
    h = h.padStart(2, "0");
    m = m.padStart(2, "0");
    return `${h}:${m}`;
  } else {
    const t = String(s).padStart(4, "0");
    return `${t.slice(0, 2)}:${t.slice(2)}`;
  }
}

// binary insertion into sorted day array by start_time
function insertSortedByStart(arr, event) {
  if (!event.start_time || event.start_time === "N/A") {
    arr.push(event);
    return;
  }
  let low = 0, high = arr.length - 1, idx = arr.length;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midTime = arr[mid].start_time || "N/A";
    if (midTime === "N/A" || midTime.localeCompare(event.start_time) <= 0) {
      low = mid + 1;
    } else {
      idx = mid;
      high = mid - 1;
    }
  }
  arr.splice(low, 0, event);
}

// -----------------------------
// Build DSA views from schedule array
// -----------------------------
function buildDayMap(schedule) {
  const map = new Map();
  for (let i = 0; i < 7; i++) map.set(i, []);
  for (const e of schedule) {
    // convert day to index
    const dayIndex = days.indexOf(e.day);
    if (dayIndex < 0) continue;
    // create event object with same keys
    const ev = new Event(e.id, e.event, dayIndex, e.start, e.end, e.type, e.depends_on || null);
    insertSortedByStart(map.get(dayIndex), ev);
  }
  // remove empty day lists? keep them
  return map;
}

function buildHeapFromSchedule(schedule) {
  const deadlines = schedule.filter(e => e.type === "deadline").map(e => {
    return new Event(e.id, e.event, days.indexOf(e.day), "N/A", "23:59", "deadline", e.depends_on || null);
  });
  return new MinHeap(deadlines);
}

function buildGraphFromSchedule(schedule) {
  const g = new Graph();
  for (const e of schedule) {
    if (e.depends_on) {
      // store dependency by event name (prefer id if given)
      const from = e.depends_on;
      const to = e.event;
      g.addEdge(from, to);
    }
  }
  return g;
}

// -----------------------------
// CLI features: add/edit/delete/view/export
// -----------------------------
function promptAddEvents() {
  console.log("\n=== ADD EVENTS (append to schedule.json) ===");
  const schedule = loadSchedule();
  const count = readline.questionInt("How many events to add? ");
  for (let i = 0; i < count; i++) {
    console.log(`\nEvent ${i + 1}:`);
    const name = readline.question("Event Name: ").trim();
    const dayIndex = readline.keyInSelect(days, "Select Day (Cancel = -1):");
    if (dayIndex === -1) {
      console.log("Skipping this event.");
      continue;
    }
    const isDeadline = readline.keyInYNStrict("Is this a deadline-based task (due by 23:59)?");
    let start = "N/A", end = "23:59", type = "deadline";
    if (!isDeadline) {
      start = padTimeHHMM(readline.question("Start Time (HH:MM): "));
      end = padTimeHHMM(readline.question("End Time (HH:MM): "));
      type = "fixed";
    }
    const hasDep = readline.keyInYNStrict("Does this event depend on another event?");
    const depends_on = hasDep ? readline.question("Enter the name (or ID) of event it depends on: ").trim() : null;
    const id = generateId();
    const obj = {
      id,
      event: name,
      day: days[dayIndex],
      start,
      end,
      type,
      depends_on: depends_on || null
    };
    schedule.push(obj);
    console.log("Event added:", name);
  }
  saveSchedule(schedule);
  console.log("\n✅ schedule.json appended with new events.");
}

function listAllEvents(schedule) {
  if (!schedule.length) {
    console.log("No events in schedule.");
    return;
  }
  console.log("\nAll Events:");
  schedule.forEach((e, idx) => {
    console.log(`${idx + 1}. [${e.id}] ${e.event} | ${e.day} | ${e.type} | ${e.start}-${e.end}${e.depends_on ? " | depends on: " + e.depends_on : ""}`);
  });
}

function promptEditEvent() {
  console.log("\n=== EDIT EVENT ===");
  const schedule = loadSchedule();
  if (!schedule.length) {
    console.log("No events to edit.");
    return;
  }
  listAllEvents(schedule);
  const idx = readline.questionInt("Enter the event number to edit (0 to cancel): ");
  if (idx <= 0 || idx > schedule.length) {
    console.log("Cancelled.");
    return;
  }
  const event = schedule[idx - 1];
  console.log("Editing:", event.event);
  const newName = readline.question(`New name (enter to keep '${event.event}'): `).trim();
  const dayIndex = readline.keyInSelect(days, `Change day? (current: ${event.day})`);
  const isDeadline = event.type === "deadline" ? true : false;
  const changeType = readline.keyInYNStrict(`Change between deadline/fixed? (current: ${event.type})`);
  let type = event.type;
  if (changeType) {
    type = readline.keyInSelect(["fixed", "deadline"], "Choose new type:") === 0 ? "fixed" : "deadline";
  }
  let start = event.start, end = event.end;
  if (type === "fixed") {
    const s = readline.question(`Start time (${event.start}) (enter to keep): `);
    if (s) start = padTimeHHMM(s);
    const e = readline.question(`End time (${event.end}) (enter to keep): `);
    if (e) end = padTimeHHMM(e);
  } else {
    start = "N/A"; end = "23:59";
  }
  const depChange = readline.keyInYNStrict("Change dependency?");
  let depends_on = event.depends_on;
  if (depChange) {
    const has = readline.keyInYNStrict("Set a dependency?");
    depends_on = has ? readline.question("Dependency (name or id): ").trim() : null;
  }

  if (newName) event.event = newName;
  if (dayIndex !== -1) event.day = days[dayIndex];
  event.type = type;
  event.start = start;
  event.end = end;
  event.depends_on = depends_on || null;

  saveSchedule(schedule);
  console.log("\n✅ Event updated.");
}

function promptDeleteEvent() {
  console.log("\n=== DELETE EVENT ===");
  const schedule = loadSchedule();
  if (!schedule.length) {
    console.log("No events to delete.");
    return;
  }
  listAllEvents(schedule);
  const idx = readline.questionInt("Enter the event number to delete (0 to cancel): ");
  if (idx <= 0 || idx > schedule.length) {
    console.log("Cancelled.");
    return;
  }
  const removed = schedule.splice(idx - 1, 1);
  saveSchedule(schedule);
  console.log("Deleted:", removed[0].event);
}

function promptViewDay() {
  const schedule = loadSchedule();
  if (!schedule.length) {
    console.log("No schedule found.");
    return;
  }
  const dayIndex = readline.keyInSelect(days, "View which day?");
  if (dayIndex === -1) {
    console.log("Cancelled.");
    return;
  }
  const thisDay = days[dayIndex];
  const todays = schedule.filter(e => e.day === thisDay);

  console.log(`\n📅 Timetable for ${thisDay}:`);
  if (!todays.length) console.log(" No events.");
  else {
    todays.forEach(e => {
      if (e.type === "deadline") {
        console.log(`  ⏰ ${e.event} — Deadline by ${e.end}${e.depends_on ? " | depends on: " + e.depends_on : ""}`);
      } else {
        console.log(`  📘 ${e.event} — ${e.start} to ${e.end}${e.depends_on ? " | depends on: " + e.depends_on : ""}`);
      }
    });
  }

  // Build and display upcoming deadlines (from this day onward)
  const scheduleObjs = schedule.map(s => s);
  const heap = buildHeapFromSchedule(scheduleObjs);
  const sortedDeadlines = heap.asSortedArray().filter(d => d.dayIndex >= dayIndex);
  console.log("\nUpcoming deadlines (from selected day):");
  if (!sortedDeadlines.length) console.log(" None.");
  else sortedDeadlines.forEach(d => {
    console.log(`  ⏰ ${d.name} → ${d.day} by ${d.end}`);
  });

  // Build and display dependency graph (simple textual)
  const graph = buildGraphFromSchedule(scheduleObjs);
  console.log("\nTask Dependencies:");
  if (!graph.adj.size) console.log(" None.");
  else {
    for (const [from, list] of graph.adj.entries()) {
      list.forEach(to => console.log(`  ${from} ➡ ${to}`));
    }
    if (graph.hasCycle()) console.log("⚠️ Circular dependency detected!");
  }
}

function promptExportJSONPretty() {
  const schedule = loadSchedule();
  console.log("\nCurrent schedule.json content (pretty):\n");
  console.log(JSON.stringify(schedule, null, 2));
}
function promptCreateFreshTimetable() {
  console.log("\n=== CREATE NEW / FRESH TIMETABLE ===");
  const confirm = readline.keyInYNStrict("This will erase all existing events. Continue?");
  if (!confirm) {
    console.log("Cancelled. Old timetable preserved.");
    return;
  }

  const count = readline.questionInt("How many events to add in the new timetable? ");
  const newSchedule = [];

  for (let i = 0; i < count; i++) {
    console.log(`\nEvent ${i + 1}:`);
    const name = readline.question("Event Name: ").trim();
    const dayIndex = readline.keyInSelect(days, "Select Day (Cancel = -1):");
    if (dayIndex === -1) {
      console.log("Skipping this event.");
      continue;
    }
    const isDeadline = readline.keyInYNStrict("Is this a deadline-based task (due by 23:59)?");
    let start = "N/A", end = "23:59", type = "deadline";
    if (!isDeadline) {
      start = padTimeHHMM(readline.question("Start Time (HH:MM): "));
      end = padTimeHHMM(readline.question("End Time (HH:MM): "));
      type = "fixed";
    }
    const hasDep = readline.keyInYNStrict("Does this event depend on another event?");
    const depends_on = hasDep ? readline.question("Enter the name (or ID) of event it depends on: ").trim() : null;
    const id = generateId();
    const obj = {
      id,
      event: name,
      day: days[dayIndex],
      start,
      end,
      type,
      depends_on: depends_on || null
    };
    newSchedule.push(obj);
    console.log("Added:", name);
  }

  saveSchedule(newSchedule);
  console.log("\n✅ New timetable created successfully and saved to schedule.json!");
}

// -----------------------------
// Main Menu
// -----------------------------
function mainMenu() {
  while (true) {
    console.log("\n================= SMART TIMETABLE (DSA) =================");
    console.log("1. Add / Append Events");
    console.log("2. Edit an Event");
    console.log("3. Delete an Event");
    console.log("4. View Timetable for a Day (and upcoming deadlines + dependencies)");
    console.log("5. List All Events");
    console.log("6. Show JSON (console)");
    console.log("7. Create a Fresh Timetable (new schedule)");
    console.log("8. Exit");
    const choice = readline.questionInt("Enter choice: ");
    if (choice === 1) promptAddEvents();
    else if (choice === 2) promptEditEvent();
    else if (choice === 3) promptDeleteEvent();
    else if (choice === 4) promptViewDay();
    else if (choice === 5) listAllEvents(loadSchedule());
    else if (choice === 6) promptExportJSONPretty();
    else if (choice === 7) promptCreateFreshTimetable();
    else if (choice === 8) { console.log("Bye!"); break; }
    else console.log("Invalid option.");
  }
}


// If schedule.json does not exist, create empty array
if (!fs.existsSync(SCHEDULE_FILE)) {
  saveSchedule([]);
  console.log("Created new schedule.json");
}

mainMenu();
