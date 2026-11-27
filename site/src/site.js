// OpenKortex website: language and theme choice, scroll reveals, the step player, the scenes and the screenshot deck.
// No requests to other sites: everything it needs is on the page.
// Autoplay only runs while a block is on screen, pauses on hover or focus, and is off when the
// visitor asks for reduced motion (then everything is still reachable by click or keyboard).
/* global window, document, IntersectionObserver */
(function () {
  "use strict";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // An explicit language choice wins over the automatic switch on "/".
  document.querySelectorAll("a[data-lang]").forEach(function (a) {
    a.addEventListener("click", function () {
      try {
        localStorage.setItem("okx-lang", a.getAttribute("data-lang"));
      } catch {
        /* storage blocked: the choice is not remembered */
      }
    });
  });

  // Theme switch: flips between light and dark and remembers the choice; without a choice the system decides.
  document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
    b.addEventListener("click", function () {
      var root = document.documentElement;
      var now = root.getAttribute("data-theme") || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
      var next = now === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      try {
        localStorage.setItem("okx-theme", next);
      } catch {
        /* storage blocked: the choice lasts for this page */
      }
    });
  });

  // The header gets its hairline once the page has scrolled.
  var top = document.querySelector(".top");
  if (top) {
    var onScroll = function () { top.classList.toggle("is-scrolled", window.scrollY > 8); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // Scroll reveals: each [data-reveal] block rises in once when it comes into view; pictograms inside start to loop.
  // With reduced motion the stylesheet shows everything at once and nothing loops.
  var reveals = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window) {
    var ro = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add("is-in");
          ro.unobserve(e.target);
        });
      },
      { threshold: 0.18, rootMargin: "0px 0px -6% 0px" },
    );
    reveals.forEach(function (el) { ro.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  }

  // Marquees loop seamlessly: the list is doubled once, the copy hidden from assistive technology.
  document.querySelectorAll(".marquee ul").forEach(function (ul) {
    Array.prototype.slice.call(ul.children).forEach(function (li) {
      var c = li.cloneNode(true);
      c.setAttribute("aria-hidden", "true");
      ul.appendChild(c);
    });
  });

  // The hero orbit uses SVG animation; hold it still for reduced motion.
  if (reduced) {
    var svg = document.querySelector(".orbit svg");
    if (svg && svg.pauseAnimations) svg.pauseAnimations();
  }

  // Capture kinds: every 1.1 s the next chip (Website, E-book, Recipe, ...) leaves its app, travels to
  // the center and dissolves there. Only while the hero is on screen and the tab is visible.
  var orbit = document.querySelector(".orbit");
  var kinds = orbit ? Array.prototype.slice.call(orbit.querySelectorAll(".o-kinds li")) : [];
  if (kinds.length && !reduced && orbit.animate) {
    var k = 0;
    var seen = true;
    new IntersectionObserver(function (e) { seen = e[0].isIntersecting; }, { threshold: 0.2 }).observe(orbit);
    var send = function () {
      if (!seen || document.hidden) return;
      var chip = kinds[k++ % kinds.length];
      var size = orbit.getBoundingClientRect().width;
      var x = (chip.getAttribute("data-x") / 560) * size;
      var y = (chip.getAttribute("data-y") / 560) * size;
      var c = size / 2;
      var at = function (px, py, scale) { return "translate(" + px + "px," + py + "px) translate(-50%,-50%) scale(" + scale + ")"; };
      // Start a little toward the center, so the chip appears beside its app label, not on top of it.
      var sx = x + (c - x) * 0.3;
      var sy = y + (c - y) * 0.3;
      chip.animate(
        [
          { transform: at(sx, sy, 0.7), opacity: 0, offset: 0 },
          { transform: at(sx + (c - sx) * 0.08, sy + (c - sy) * 0.08, 1), opacity: 1, offset: 0.18 },
          { transform: at(sx + (c - sx) * 0.72, sy + (c - sy) * 0.72, 1), opacity: 1, offset: 0.78 },
          { transform: at(sx + (c - sx) * 0.9, sy + (c - sy) * 0.9, 0.4), opacity: 0, offset: 1 },
        ],
        { duration: 3000, easing: "cubic-bezier(0.45, 0, 0.3, 1)" },
      );
    };
    setTimeout(function () {
      send();
      setInterval(send, 1100);
    }, 1700);
  }

  /** Runs `tick` every `ms` while `el` is visible and not hovered/focused. */
  function autoplay(el, ms, tick, onState) {
    if (reduced) return function () {};
    var timer = null;
    var visible = false;
    var held = false;
    function stop() {
      clearTimeout(timer);
      timer = null;
      if (onState) onState(false);
    }
    function start() {
      stop();
      if (!visible || held) return;
      if (onState) onState(true);
      timer = setTimeout(function () {
        tick();
        start();
      }, ms);
    }
    new IntersectionObserver(
      function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) start();
        else stop();
      },
      { threshold: 0.35 },
    ).observe(el);
    el.addEventListener("mouseenter", function () { held = true; stop(); });
    el.addEventListener("mouseleave", function () { held = false; start(); });
    el.addEventListener("focusin", function () { held = true; stop(); });
    el.addEventListener("focusout", function () { held = false; start(); });
    return start; // restart after a manual change
  }

  /* ---------- steps: Capture, Sort, Connect, Ask ---------- */
  var steps = document.querySelector("[data-steps]");
  if (steps) {
    var tabs = Array.prototype.slice.call(steps.querySelectorAll('[role="tab"]'));
    var panes = tabs.map(function (t) { return document.getElementById(t.getAttribute("aria-controls")); });
    var current = 0;
    var MS = 5200;
    steps.style.setProperty("--step-ms", MS + "ms");
    function show(i) {
      current = (i + tabs.length) % tabs.length;
      tabs.forEach(function (t, k) {
        var on = k === current;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        panes[k].hidden = !on;
        panes[k].classList.toggle("is-on", on);
      });
      // Restart the progress bar animation of the active step.
      var bar = tabs[current].querySelector(".bar");
      if (bar) {
        bar.style.display = "none";
        void bar.offsetWidth;
        bar.style.display = "";
      }
    }
    var restart = autoplay(steps, MS, function () { show(current + 1); }, function (on) { steps.classList.toggle("is-playing", on); });
    tabs.forEach(function (t, k) {
      t.addEventListener("click", function () { show(k); restart(); });
      t.addEventListener("keydown", function (e) {
        var d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        show(current + d);
        tabs[current].focus();
      });
    });
    show(0);
  }

  /* ---------- scenes: replay while on screen ---------- */
  // Each scene is a short CSS choreography that starts when .is-live is set. Removing and setting the class
  // again replays it. With reduced motion the class is never set and the scene shows its final state.
  if (!reduced) {
    document.querySelectorAll("[data-scene]").forEach(function (el) {
      var ms = Number(el.getAttribute("data-scene")) || 11000;
      var timer = null;
      el.style.setProperty("--loop", ms + "ms");
      function play() {
        clearTimeout(timer);
        el.classList.remove("is-live");
        void el.offsetWidth;
        el.classList.add("is-live");
        timer = setTimeout(play, ms);
      }
      new IntersectionObserver(
        function (entries) {
          if (entries[0].isIntersecting) play();
          else {
            clearTimeout(timer);
            el.classList.remove("is-live");
          }
        },
        { threshold: 0.35 },
      ).observe(el);
    });
  }

  /* ---------- gallery deck ---------- */
  var deck = document.querySelector("[data-deck]");
  if (deck) {
    var cards = Array.prototype.slice.call(deck.querySelectorAll(".card"));
    var dtabs = Array.prototype.slice.call(deck.querySelectorAll('[role="tab"]'));
    var caption = deck.querySelector(".deck-caption");
    var tpl = deck.querySelector("template[data-captions]");
    var captions = tpl ? tpl.innerHTML.split("|") : [];
    var at = 0;
    function go(i) {
      at = (i + cards.length) % cards.length;
      cards.forEach(function (c, k) {
        var rel = (k - at + cards.length) % cards.length;
        c.classList.toggle("is-on", rel === 0);
        c.classList.toggle("is-next", rel === 1);
        c.classList.toggle("is-after", rel === 2);
        c.tabIndex = rel === 0 ? 0 : -1;
        c.setAttribute("aria-hidden", String(rel !== 0));
      });
      dtabs.forEach(function (t, k) { t.setAttribute("aria-selected", String(k === at)); });
      if (caption && captions[at]) caption.innerHTML = captions[at];
      // Load the next screen early so the cross-fade never shows an empty card.
      var next = cards[(at + 1) % cards.length].querySelector("img");
      if (next) next.loading = "eager";
    }
    var again = autoplay(deck, 5200, function () { go(at + 1); });
    dtabs.forEach(function (t, k) { t.addEventListener("click", function () { go(k); again(); }); });
    go(0);
  }
})();
