// script.js
// Fetch schedule.json and render:
// - When a day button is clicked: show only that day's tasks
// - Show upcoming deadlines from that day (min-heap style sorted by day)
// - Show dependency list graphically (simple nodes + arrows)

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function buildMinHeapFromArray(arr) {
  // simple sort-based heap-view builder for front-end (non-destructive)
  const deadlines = arr.filter(e => e.type === "deadline");
  // map day string to index for sorting
  deadlines.forEach(d => d._dayIndex = days.indexOf(d.day));
  deadlines.sort((a, b) => {
    if (a._dayIndex !== b._dayIndex) return a._dayIndex - b._dayIndex;
    return 0;
  });
  return deadlines;
}

function buildDependencyPairs(arr) {
  const pairs = [];
  arr.forEach(e => {
    if (e.depends_on) pairs.push({ from: e.depends_on, to: e.event });
  });
  return pairs;
}

fetch("schedule.json")
  .then(resp => resp.json())
  .then(data => {
    const container = document.getElementById("timetable-container");
    const heapList = document.getElementById("heap-list");
    const graphContainer = document.getElementById("graph-container");

    // Render 'All days' view initially OR nothing — we'll wait for clicks
    // Prepare structured data
    const heapAll = buildMinHeapFromArray(data);
    const dependencyPairs = buildDependencyPairs(data);

    // Build day-based groups
    const byDay = {};
    days.forEach(d => byDay[d] = []);
    data.forEach(e => {
      if (!byDay[e.day]) byDay[e.day] = [];
      byDay[e.day].push(e);
    });

    // Attach click handlers on filter buttons
    const buttons = document.querySelectorAll(".filter-btn");
    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        buttons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const selectedDay = btn.dataset.day;
        renderForDay(selectedDay, byDay, heapAll, dependencyPairs);
      });
    });

    // render for default active (All Days) on load
    const active = document.querySelector(".filter-btn.active");
    if (active) renderForDay(active.dataset.day, byDay, heapAll, dependencyPairs);
  })
  .catch(err => {
    console.error("Failed to fetch schedule.json:", err);
    document.getElementById("timetable-container").innerHTML = `<p class="error">Unable to load schedule.json</p>`;
  });

function clearContainers() {
  document.getElementById("timetable-container").innerHTML = "";
  document.getElementById("heap-list").innerHTML = "";
  document.getElementById("graph-container").innerHTML = "";
}

function renderForDay(selectedDay, byDay, heapAll, dependencyPairs) {
  clearContainers();
  const container = document.getElementById("timetable-container");
  const heapList = document.getElementById("heap-list");
  const graphContainer = document.getElementById("graph-container");

  // 1) Show tasks for selectedDay (if 'all', show all tasks)
  const tasks = selectedDay === "all" ? Object.values(byDay).flat() : (byDay[selectedDay] || []);
  if (!tasks.length) {
    container.innerHTML = `<p style="text-align:center; color:#666">No events for ${selectedDay}</p>`;
  } else {
    tasks.forEach(e => {
      const card = document.createElement("div");
      card.classList.add("card");
      const isDeadline = e.type === "deadline";
      const timeText = isDeadline ? `Deadline: ${e.end}` : `${e.start} - ${e.end}`;
      card.innerHTML = `
        <div class="card-header" style="border-color:${isDeadline ? '#ff5e5e' : '#4cafef'}">
          <h3>${isDeadline ? "⏰" : "📘"} ${e.event}</h3>
          <span class="day">${e.day}</span>
        </div>
        <div class="card-body">
          <p><strong>Time:</strong> ${timeText}</p>
          ${e.depends_on ? `<p><strong>Depends on:</strong> ${e.depends_on}</p>` : ""}
        </div>
      `;
      container.appendChild(card);
    });
  }

  // 2) Upcoming deadlines (from that day onward)
  const selectedIndex = selectedDay === "all" ? 0 : days.indexOf(selectedDay);
  const upcoming = heapAll.filter(h => h._dayIndex >= selectedIndex);
  if (!upcoming.length) {
    heapList.innerHTML = `<li>No upcoming deadlines from ${selectedDay}</li>`;
  } else {
    upcoming.forEach(d => {
      const li = document.createElement("li");
      li.textContent = `${d.event} — ${d.day} by ${d.end}`;
      heapList.appendChild(li);
    });
  }

  // 3) Dependency graph (simple arrow list)
  if (!dependencyPairs.length) {
    graphContainer.innerHTML = `<p style="text-align:center; color:#666">No dependencies</p>`;
  } else {
    // Only show pairs that involve events present in selectedDay or all
    const showPairs = dependencyPairs.filter(p => {
      if (selectedDay === "all") return true;
      // show if either from or to is on selectedDay
      const fromEvent = findEventByNameOrId(p.from);
      const toEvent = findEventByNameOrId(p.to);
      if (!fromEvent && !toEvent) return false;
      return (fromEvent && fromEvent.day === selectedDay) || (toEvent && toEvent.day === selectedDay) || selectedDay === "all";
    });

    if (!showPairs.length) {
      graphContainer.innerHTML = `<p style="text-align:center; color:#666">No dependencies for ${selectedDay}</p>`;
    } else {
      showPairs.forEach(p => {
        const nodeA = document.createElement("div");
        nodeA.className = "node";
        nodeA.textContent = p.from;

        const arrow = document.createElement("div");
        arrow.className = "arrow";
        arrow.textContent = "➡️";

        const nodeB = document.createElement("div");
        nodeB.className = "node";
        nodeB.textContent = p.to;

        graphContainer.append(nodeA, arrow, nodeB);
      });
    }
  }
}

// helper: find event by name/id from the loaded schedule (fetch synchronously from schedule.json)
function findEventByNameOrId(key) {
  // synchronous fetch of schedule.json (small file, okay)
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "schedule.json", false); // synchronous
    xhr.send(null);
    if (xhr.status === 200) {
      const arr = JSON.parse(xhr.responseText);
      return arr.find(e => e.id === key || e.event === key);
    }
  } catch (err) {
    // ignore
  }
  return null;
}
