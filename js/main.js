(() => {
  const header = document.querySelector(".site-header");
  const toggle = document.querySelector(".nav-toggle");
  const panel = document.querySelector(".nav-panel");
  const backTop = document.querySelector(".back-top");
  const cookie = document.querySelector(".cookie");
  const cookieBtn = document.querySelector("[data-cookie-dismiss]");
  const form = document.querySelector(".js-contact-form");
  const loader = document.querySelector("#loader");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const EASE = [0.22, 1, 0.36, 1];

  // Resolved from this script's own URL: dynamic import() in a classic script
  // resolves against the document, which would miss the js/ directory.
  const motionUrl = document.currentScript
    ? new URL("vendor/motion.js", document.currentScript.src).href
    : "js/vendor/motion.js";

  // Containers whose children come in one after another instead of as a block.
  const STAGGER_GROUPS = [
    [".hero-copy", ".reveal"],
    [".flavor-pills", "a"],
    [".exp-points", "li"],
    [".product-grid", ".pcard"],
    [".diff-list", "li"],
    [".faq-list", ".faq-item"],
    [".footer-grid", ":scope > *"],
  ];

  const showAll = () => {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
  };

  // Fallback for reduced motion, old browsers, or a failed Motion load.
  const revealWithObserver = () => {
    const els = document.querySelectorAll(".reveal");
    if (reduceMotion || !("IntersectionObserver" in window)) {
      showAll();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -24px 0px" }
    );
    els.forEach((el) => io.observe(el));
  };

  const revealWithMotion = ({ animate, inView, stagger, hover }) => {
    document.documentElement.classList.add("motion");

    // inView re-fires every time a target re-enters, so each reveal is latched.
    const inViewOnce = (target, run) => {
      let spent = false;
      const stop = inView(
        target,
        () => {
          if (spent) return;
          spent = true;
          run();
          if (typeof stop === "function") stop();
        },
        { amount: 0.15 }
      );
    };

    const fadeUp = (targets, options) =>
      animate(targets, { opacity: [0, 1], y: [16, 0] }, { duration: 0.7, ease: EASE, ...options });

    const grouped = new Set();

    STAGGER_GROUPS.forEach(([containerSel, itemSel]) => {
      document.querySelectorAll(containerSel).forEach((container) => {
        const items = Array.from(container.querySelectorAll(itemSel));
        if (!items.length) return;
        items.forEach((item) => {
          grouped.add(item);
          // Children that carry no .reveal class would otherwise flash first.
          item.style.opacity = "0";
        });
        container.classList.remove("reveal");
        inViewOnce(container, () => fadeUp(items, { delay: stagger(0.07) }));
      });
    });

    document.querySelectorAll(".reveal").forEach((el) => {
      if (grouped.has(el)) return;
      inViewOnce(el, () => fadeUp(el, { duration: 0.75 }));
    });

    const onHover = (selector, over, out) => {
      document.querySelectorAll(selector).forEach((el) => {
        hover(el, () => {
          animate(el, over, { duration: 0.35, ease: EASE });
          return () => animate(el, out, { duration: 0.35, ease: EASE });
        });
      });
    };

    onHover(".pcard", { y: -6 }, { y: 0 });
    onHover(".btn", { scale: 1.035 }, { scale: 1 });
    onHover(".flavor-pills a", { y: -3 }, { y: 0 });
    onHover(".back-top", { scale: 1.1 }, { scale: 1 });

    document.querySelectorAll(".pcard-toggle").forEach((toggle) => {
      const mark = toggle.querySelector(".plus");
      if (!mark) return;
      let open = false;
      const spin = (extra) =>
        animate(mark, { rotate: open ? 135 : 0, scale: extra }, { duration: 0.35, ease: EASE });

      hover(toggle, () => {
        spin(1.1);
        return () => spin(1);
      });

      // Rotation lives here rather than in CSS so it composes with the hover scale.
      toggle.addEventListener("grano:toggle", (event) => {
        open = event.detail.open;
        spin(1);
      });
    });
  };

  const startAnimations = () => {
    if (reduceMotion) {
      showAll();
      return;
    }
    import(motionUrl)
      .then(revealWithMotion)
      .catch(revealWithObserver);
  };

  let loaded = false;
  const finishLoad = () => {
    if (loaded) return;
    loaded = true;
    document.documentElement.classList.remove("is-loading");
    if (loader) loader.classList.add("is-done");
    window.setTimeout(startAnimations, reduceMotion ? 0 : 280);
  };

  if (reduceMotion || !loader) {
    finishLoad();
  } else {
    const started = Date.now();
    const minMs = 2000;
    const heroVideo = document.querySelector(".hero-video");
    const proceed = () => {
      const wait = Math.max(0, minMs - (Date.now() - started));
      window.setTimeout(finishLoad, wait);
    };
    if (heroVideo) {
      if (heroVideo.readyState >= 2) proceed();
      else {
        heroVideo.addEventListener("loadeddata", proceed, { once: true });
        heroVideo.addEventListener("error", proceed, { once: true });
      }
    } else {
      proceed();
    }
    window.setTimeout(finishLoad, 4200);
  }

  // Mute loops: play when in view, pause when not. No on-page controls.
  document.querySelectorAll(".js-autoplay-video").forEach((video) => {
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");

    const tryPlay = () => {
      if (reduceMotion) {
        video.pause();
        return;
      }
      const attempt = video.play();
      if (attempt && typeof attempt.catch === "function") attempt.catch(() => {});
    };

    if (reduceMotion) {
      video.pause();
      video.removeAttribute("autoplay");
      return;
    }

    tryPlay();

    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        ([entry]) => {
          if (!entry) return;
          if (entry.isIntersecting) tryPlay();
          else video.pause();
        },
        { threshold: 0.25 }
      );
      io.observe(video);
    }
  });

  let navScrollY = 0;

  const setNav = (open) => {
    if (!toggle || !panel) return;

    if (open) {
      navScrollY = window.scrollY;
      document.body.style.position = "fixed";
      document.body.style.top = `-${navScrollY}px`;
      document.body.style.width = "100%";
    } else {
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
      window.scrollTo(0, navScrollY);
    }

    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    panel.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", String(!open));
    document.body.classList.toggle("nav-open", open);
  };

  const closeNav = () => setNav(false);

  const onScroll = () => {
    if (header) {
      header.classList.toggle("is-stuck", window.scrollY > 8);
    }
    if (backTop) {
      backTop.classList.toggle("is-visible", window.scrollY > 640);
    }
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if (toggle && panel) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      setNav(!open);
    });

    panel.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeNav);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeNav();
    });
  }

  document.querySelectorAll(".faq-item button").forEach((button) => {
    button.addEventListener("click", () => {
      const expanded = button.getAttribute("aria-expanded") === "true";
      document.querySelectorAll(".faq-item button").forEach((other) => {
        other.setAttribute("aria-expanded", "false");
      });
      button.setAttribute("aria-expanded", String(!expanded));
    });
  });

  const setCard = (card, open) => {
    const toggle = card.querySelector(".pcard-toggle");
    card.classList.toggle("is-open", open);
    toggle?.setAttribute("aria-expanded", String(open));
    toggle?.dispatchEvent(new CustomEvent("grano:toggle", { detail: { open } }));
  };

  document.querySelectorAll(".pcard").forEach((card) => {
    const toggle = card.querySelector(".pcard-toggle");
    toggle?.addEventListener("click", () => {
      setCard(card, !card.classList.contains("is-open"));
    });
  });

  const openCardFromHash = () => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const card = document.getElementById(id);
    if (card?.classList.contains("pcard")) setCard(card, true);
  };

  window.addEventListener("hashchange", openCardFromHash);
  openCardFromHash();

  const cookieKey = "grano-cookie-ok";
  const syncCookie = () => {
    const hidden = !cookie || cookie.classList.contains("is-hidden");
    document.body.classList.toggle("has-cookie", Boolean(cookie) && !hidden);
  };
  if (cookie) {
    if (localStorage.getItem(cookieKey)) {
      cookie.classList.add("is-hidden");
    }
    cookieBtn?.addEventListener("click", () => {
      localStorage.setItem(cookieKey, "1");
      cookie.classList.add("is-hidden");
      syncCookie();
    });
  }
  syncCookie();

  const emailOk = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const setFieldState = (field, valid, message) => {
    field.classList.toggle("is-invalid", !valid);
    const error = field.querySelector(".field-error");
    if (error && !valid) error.textContent = message;
  };

  if (form) {
    const status = form.querySelector(".form-status");
    const submit = form.querySelector("[type='submit']");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const nameField = form.querySelector("[data-field='name']");
      const emailField = form.querySelector("[data-field='email']");
      const messageField = form.querySelector("[data-field='message']");
      const name = form.elements.namedItem("name");
      const email = form.elements.namedItem("email");
      const message = form.elements.namedItem("message");
      const consent = form.elements.namedItem("consent");

      let valid = true;
      if (!name.value.trim()) {
        setFieldState(nameField, false, "Please add your name.");
        valid = false;
      } else {
        setFieldState(nameField, true);
      }

      if (!emailOk(email.value.trim())) {
        setFieldState(emailField, false, "Please use a valid email address.");
        valid = false;
      } else {
        setFieldState(emailField, true);
      }

      if (message.value.trim().length < 10) {
        setFieldState(messageField, false, "Please add a little more detail, at least a sentence.");
        valid = false;
      } else {
        setFieldState(messageField, true);
      }

      if (!valid) {
        status.className = "form-status is-err";
        status.textContent = "Please fix the highlighted fields and try again.";
        return;
      }

      status.className = "form-status";
      status.textContent = "Sending…";
      submit.disabled = true;

      const payload = {
        name: name.value.trim(),
        email: email.value.trim(),
        message: message.value.trim(),
        topic: form.elements.namedItem("topic")?.value || "General",
        updates: Boolean(consent?.checked),
        _subject: "Grano website enquiry",
      };

      const endpoint = form.getAttribute("data-endpoint");

      try {
        if (endpoint) {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(payload),
          });
          if (!response.ok) throw new Error("send-failed");
        } else {
          const body = encodeURIComponent(
            `${payload.message}\n\n— ${payload.name}\nTopic: ${payload.topic}\nUpdates: ${payload.updates ? "yes" : "no"}`
          );
          window.location.href = `mailto:hello@grano.ca?subject=${encodeURIComponent(payload._subject)}&body=${body}`;
        }

        form.classList.add("is-sent");
        status.className = "form-status is-ok";
        status.textContent = "";
      } catch (error) {
        status.className = "form-status is-err";
        status.innerHTML =
          'We could not send that just now. Email us directly at <a href="mailto:hello@grano.ca">hello@grano.ca</a>.';
      } finally {
        submit.disabled = false;
      }
    });
  }
})();
