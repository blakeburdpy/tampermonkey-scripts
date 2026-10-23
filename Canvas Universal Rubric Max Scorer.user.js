
// ==UserScript==
// @name         Canvas Universal Rubric Max Scorer
// @namespace    https://github.com/blakeburdpy/tampermonkey-scripts
// @version      3.5
// @description  Rubric scoring, verified saves, navigation, diagnostics
// @match        https://*.instructure.com/courses/*/gradebook/speed_grader*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// DOMAIN COMPATIBILITY:
// This script is configured for Canvas installations hosted on
// *.instructure.com. If your institution uses a custom Canvas domain,
// update the @match directive above to match your institution's URL.
// Example: https://canvas.example.edu/courses/*/gradebook/speed_grader*

/*

 * CANVAS RUBRIC HELPER — VERSION HISTORY
 * Newest first
 *
 * v3.5 — Targeted Canvas save-alert detection using the
 *        confirmed React portal and data-testid="alert".
 *        Added navigation diagnostics.
 *
 * v3.4 — Integrated diagnostics with stethoscope toggle,
 *        event log, report copying, and JSDoc documentation.
 *
 * v3.3 — Added Max + Submit + Next and save safeguards.
 *
 * v3.2 — Draggable panel, saved position, busy lock,
 *        and removal of confirmation dialogs.
 *
 * v3.0 — Universal rubric detection and maximum scoring.
 *
 * v2.x — Side-scroller-specific rubric automation.
 *
 * v1.x — Initial SpeedGrader automation experiments.
 *
 * Earlier entries summarize development milestones.
 */

(function () {
  'use strict';

  if (window !== window.top) return;

  // ================================================
  // CONFIGURATION
  // ================================================

  const CONFIG = {
    panelId: 'tm-rubric-controls',
    storageKey: 'tm-rubric-panel-position',
    saveTimeout: 12000,
    ratingDelay: 160,
    maxLogEntries: 50,
    saveSelector:
      '#react-router-portals [data-testid="alert"]',
    saveText: 'Rubric Assessment Saved'
  };

  const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  let busy = false;
  let diagnosticsEnabled = false;
  let diagnosticObserver = null;
  let events = [];
  let lastSaveElement = null;

  // ================================================
  // DIAGNOSTIC LOGGING
  // ================================================

  /**
   * Records a diagnostic event when diagnostics
   * are enabled.
   *
   * @param {string} type - Event category.
   * @param {string} message - Event description.
   * @param {Object} [details={}] - Technical metadata.
   * @returns {void}
   */
  function logEvent(type, message, details = {}) {
    if (!diagnosticsEnabled) return;

    events.push({
      time: new Date().toLocaleTimeString(),
      type,
      message,
      details
    });

    if (events.length > CONFIG.maxLogEntries) {
      events.shift();
    }

    renderLog();
  }

  /**
   * Updates the grading panel status.
   *
   * @param {string} message - Status message.
   * @returns {void}
   */
  function setStatus(message) {
    const element = document.getElementById(
      'tm-rubric-status'
    );

    if (element) element.textContent = message;

    logEvent('status', message);
  }

  /**
   * Describes a DOM element without copying
   * surrounding student or submission content.
   *
   * @param {Element|null} element
   * @returns {Object|null}
   */
  function describeElement(element) {
    if (!element) return null;

    const path = [];
    let current = element;

    for (
      let depth = 0;
      current && depth < 7;
      depth++, current = current.parentElement
    ) {
      let part = current.tagName.toLowerCase();

      if (current.id) {
        part += '#' + current.id;
        path.unshift(part);
        break;
      }

      const testId = current.getAttribute('data-testid');

      if (testId) {
        part += `[data-testid="${testId}"]`;
      }

      path.unshift(part);
    }

    return {
      path: path.join(' > '),
      tag: element.tagName,
      id: element.id || null,
      className:
        typeof element.className === 'string'
          ? element.className
          : null,
      testId: element.getAttribute('data-testid'),
      ariaLabel: element.getAttribute('aria-label'),
      title: element.getAttribute('title'),
      role: element.getAttribute('role')
    };
  }

  // ================================================
  // RUBRIC DISCOVERY
  // ================================================

  /**
   * Returns the current Canvas rubric container.
   *
   * @returns {Element|null}
   */
  function getRubric() {
    return document.querySelector(
      '#rubric-feedback-tab'
    );
  }

  /**
   * Returns rows containing rating controls.
   *
   * @returns {Element[]}
   */
  function getCriteria() {
    const rubric = getRubric();

    if (!rubric) return [];

    return [...rubric.querySelectorAll('tr')]
      .filter(row =>
        row.querySelector(
          'button[data-testid*="-ratings-"]'
        )
      );
  }

  /**
   * Identifies the highest-point rating in a row.
   *
   * @param {Element} row - Rubric criterion row.
   * @returns {{testId:string,points:number}|null}
   */
  function getMaximumRating(row) {
    const options = [...row.querySelectorAll(
      'button[data-testid*="-ratings-"]'
    )].map(button => ({
      testId: button.getAttribute('data-testid'),
      points: parseFloat(
        button.querySelector(
          '[data-testid$="-points"]'
        )?.textContent || ''
      )
    })).filter(option =>
      option.testId &&
      Number.isFinite(option.points)
    );

    options.sort((a, b) => b.points - a.points);

    return options[0] || null;
  }

  // ================================================
  // MAXIMUM SCORING
  // ================================================

  /**
   * Selects the maximum rating for every criterion.
   *
   * Re-queries controls between clicks because
   * Canvas may rerender the rubric.
   *
   * @returns {Promise<boolean>}
   */
  async function maximizeRubric() {
    const rows = getCriteria();

    if (!rows.length) {
      setStatus('No rubric criteria found.');
      return false;
    }

    const choices = rows.map(getMaximumRating);

    if (choices.some(choice => !choice)) {
      setStatus('Could not read every rating.');
      return false;
    }

    for (let i = 0; i < choices.length; i++) {
      const rubric = getRubric();

      const button = [
        ...(rubric?.querySelectorAll(
          'button[data-testid]'
        ) || [])
      ].find(candidate =>
        candidate.getAttribute('data-testid') ===
        choices[i].testId
      );

      if (!button || button.disabled) {
        setStatus(
          `Stopped at criterion ${i + 1}.`
        );
        return false;
      }

      button.click();

      logEvent('rating', `Criterion ${i + 1} selected`, {
        testId: choices[i].testId,
        points: choices[i].points
      });

      await sleep(CONFIG.ratingDelay);
    }

    const total = choices.reduce(
      (sum, choice) => sum + choice.points,
      0
    );

    setStatus(
      `Max selected: ${total} pts (${choices.length} criteria)`
    );

    return true;
  }

  // ================================================
  // RUBRIC SUBMISSION
  // ================================================

  /**
   * Finds the Canvas rubric submission control.
   *
   * @returns {HTMLElement|null}
   */
  function getSubmitButton() {
    const rubric = getRubric();

    if (!rubric) return null;

    const labels = [
      'submit assessment',
      'submit rubric',
      'save rubric',
      'save assessment',
      'update rubric',
      'update assessment'
    ];

    return [...rubric.querySelectorAll(
      'button, input[type="submit"]'
    )].find(button => {
      const label = (
        button.innerText ||
        button.value ||
        button.getAttribute('aria-label') ||
        ''
      ).trim().toLowerCase();

      return labels.includes(label);
    }) || null;
  }

  /**
   * Clicks the Canvas submission control.
   *
   * A successful click does not prove the rubric
   * has been saved.
   *
   * @returns {boolean}
   */
  function submitRubric() {
    const button = getSubmitButton();

    if (!button || button.disabled) {
      setStatus('Submit button unavailable.');
      return false;
    }

    logEvent('submit', 'Submit button clicked',
      describeElement(button)
    );

    button.click();

    setStatus('Submission requested.');
    return true;
  }

  // ================================================
  // SAVE CONFIRMATION
  // ================================================

  /**
   * Checks whether an element belongs to the
   * confirmed Canvas rubric-save notification.
   *
   * @param {Element|null} element
   * @returns {boolean}
   */
  function isSaveMessage(element) {
    if (!(element instanceof Element)) return false;

    const alert = element.matches(CONFIG.saveSelector)
      ? element
      : element.closest(CONFIG.saveSelector);

    if (!alert) return false;

    const text = (alert.textContent || '')
      .trim()
      .replace(/\s+/g, ' ');

    return text === CONFIG.saveText;
  }

  /**
   * Searches an inserted or modified DOM node
   * for the save notification.
   *
   * @param {Node} node
   * @returns {Element|null}
   */
  function findSaveAlert(node) {
    const root = node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : node;

    if (!(root instanceof Element)) return null;

    const candidates = [
      root,
      ...root.querySelectorAll(CONFIG.saveSelector)
    ];

    for (const candidate of candidates) {
      if (!isSaveMessage(candidate)) continue;

      return candidate.matches(CONFIG.saveSelector)
        ? candidate
        : candidate.closest(CONFIG.saveSelector);
    }

    return null;
  }

  /**
   * Watches for a new rubric-save notification.
   *
   * Start the watcher before submitting.
   * Existing alerts do not immediately count.
   *
   * @param {number} timeoutMs
   * @returns {{promise:Promise<boolean>,cancel:Function}}
   */
  function watchForFreshSave(timeoutMs) {
    let finish;

    const promise = new Promise(resolve => {
      let completed = false;
      let timer;

      const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          const nodes =
            mutation.type === 'characterData'
              ? [mutation.target]
              : [...mutation.addedNodes];

          for (const node of nodes) {
            const alert = findSaveAlert(node);

            if (!alert) continue;

            lastSaveElement = describeElement(alert);

            logEvent(
              'save',
              'Rubric Assessment Saved',
              lastSaveElement
            );

            finish(true);
            return;
          }
        }
      });

      finish = success => {
        if (completed) return;

        completed = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(success);
      };

      observer.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true
      });

      timer = setTimeout(
        () => finish(false),
        timeoutMs
      );
    });

    return {
      promise,
      cancel: () => finish(false)
    };
  }

  // ================================================
  // NEXT STUDENT NAVIGATION
  // ================================================

  /**
   * Locates an enabled Next Student control.
   *
   * @returns {HTMLElement|null}
   */
  function getNextStudentButton() {
    const selectors = [
      '#next-student-button',
      '#next_student',
      'button[aria-label="Next Student"]',
      'button[aria-label="Next student"]',
      '[data-testid="next-student-button"]'
    ];

    const usable = element =>
      element &&
      !element.disabled &&
      element.getAttribute('aria-disabled') !== 'true' &&
      !element.closest('#' + CONFIG.panelId);

    for (const selector of selectors) {
      const element = document.querySelector(selector);

      if (usable(element)) return element;
    }

    return [...document.querySelectorAll(
      'button, a[role="button"], a'
    )].find(element => {
      if (!usable(element)) return false;

      if (element.closest('#rubric-feedback-tab')) {
        return false;
      }

      const label = (
        element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        element.innerText ||
        ''
      ).trim();

      return /^next student$/i.test(label);
    }) || null;
  }

  /**
   * Collects possible navigation controls for
   * diagnostic reports.
   *
   * @returns {Object[]}
   */
  function getNavigationCandidates() {
    return [...document.querySelectorAll(
      'button, a[role="button"], a'
    )].filter(element =>
      !element.closest('#' + CONFIG.panelId)
    ).filter(element => {
      const attributes = [
        element.id,
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        element.getAttribute('data-testid')
      ].filter(Boolean).join(' ');

      return /next|previous|student/i.test(attributes);
    }).slice(0, 12).map(describeElement);
  }

  // ================================================
  // COMBINED ACTIONS
  // ================================================

  /**
   * Maximizes and submits the current rubric.
   *
   * @returns {Promise<void>}
   */
  async function maxAndSubmit() {
    if (!(await maximizeRubric())) return;

    await sleep(400);
    submitRubric();
  }

  /**
   * Maximizes, submits, waits for confirmation,
   * then advances to the next student.
   *
   * Navigation is skipped if saving cannot be
   * confirmed or the next control is unavailable.
   *
   * @returns {Promise<void>}
   */
  async function maxSubmitNext() {
    setStatus('Selecting maximum ratings...');

    if (!(await maximizeRubric())) return;

    await sleep(400);

    const watcher = watchForFreshSave(
      CONFIG.saveTimeout
    );

    if (!submitRubric()) {
      watcher.cancel();
      return;
    }

    setStatus('Waiting for Canvas save...');

    const saved = await watcher.promise;

    if (!saved) {
      setStatus(
        'Save not confirmed. Student NOT advanced.'
      );

      logEvent(
        'warning',
        'Save confirmation timed out'
      );

      return;
    }

    const next = getNextStudentButton();

    if (!next) {
      setStatus(
        'Saved, but Next Student button not found.'
      );

      logEvent(
        'warning',
        'Next Student control not found',
        { candidates: getNavigationCandidates() }
      );

      return;
    }

    logEvent(
      'navigation',
      'Clicking Next Student',
      describeElement(next)
    );

    await sleep(300);

    next.click();

    setStatus('Saved. Next Student clicked.');
  }

  /**
   * Prevents overlapping grading actions.
   *
   * @param {Function} action
   * @returns {Promise<void>}
   */
  async function runAction(action) {
    if (busy) return;

    busy = true;
    updateButtons(true);

    try {
      await action();
    } catch (error) {
      console.error('Rubric Helper:', error);

      setStatus('Error — review current student.');
      logEvent('error', String(error));
    } finally {
      busy = false;
      updateButtons(false);
    }
  }

  /**
   * Enables or disables grading controls.
   *
   * @param {boolean} disabled
   * @returns {void}
   */
  function updateButtons(disabled) {
    document.querySelectorAll(
      `#${CONFIG.panelId} button[data-rubric-action]`
    ).forEach(button => {
      button.disabled = disabled;
      button.style.opacity = disabled ? '0.6' : '1';
    });
  }

  // ================================================
  // OPTIONAL DIAGNOSTICS
  // ================================================

  /**
   * Renders the bounded diagnostic event history.
   *
   * @returns {void}
   */
  function renderLog() {
    const output = document.getElementById(
      'tm-rubric-diagnostic-output'
    );

    if (!output) return;

    output.value = events.map(entry =>
      `${entry.time} [${entry.type}] ${entry.message}`
    ).join('\n');

    output.scrollTop = output.scrollHeight;
  }

  /**
   * Enables or disables passive diagnostic
   * observation and the diagnostic panel.
   *
   * @param {boolean} enabled
   * @returns {void}
   */
  function setDiagnostics(enabled) {
    diagnosticsEnabled = enabled;

    const panel = document.getElementById(
      'tm-rubric-diagnostic-panel'
    );

    const toggle = document.getElementById(
      'tm-rubric-diagnostic-toggle'
    );

    if (panel) panel.hidden = !enabled;

    if (toggle) {
      toggle.setAttribute(
        'aria-pressed',
        String(enabled)
      );

      toggle.title = enabled
        ? 'Disable diagnostics'
        : 'Enable diagnostics';

      toggle.style.background = enabled
        ? '#24854b'
        : '#46566a';
    }

    if (diagnosticObserver) {
      diagnosticObserver.disconnect();
      diagnosticObserver = null;
    }

    if (!enabled) return;

    events = [];

    diagnosticObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        const nodes =
          mutation.type === 'characterData'
            ? [mutation.target]
            : [...mutation.addedNodes];

        for (const node of nodes) {
          const alert = findSaveAlert(node);

          if (!alert) continue;

          lastSaveElement = describeElement(alert);

          logEvent(
            'notification',
            'Observed Rubric Assessment Saved',
            lastSaveElement
          );

          return;
        }
      }
    });

    diagnosticObserver.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });

    logEvent('diagnostics', 'Diagnostics enabled');
  }

  /**
   * Builds a diagnostic report without copying
   * the student's submission or surrounding HTML.
   *
   * @returns {string}
   */
  function buildReport() {
    const submit = getSubmitButton();
    const next = getNextStudentButton();

    return JSON.stringify({
      version: '3.5',
      rubricPresent: Boolean(getRubric()),
      criteriaDetected: getCriteria().length,
      submitButton: describeElement(submit),
      nextStudentButton: describeElement(next),
      navigationCandidates: getNavigationCandidates(),
      lastSaveNotification: lastSaveElement,
      events
    }, null, 2);
  }

  // ================================================
  // PANEL POSITION
  // ================================================

  /**
   * Saves the draggable panel's current position.
   *
   * @param {HTMLElement} panel
   * @returns {void}
   */
  function savePosition(panel) {
    try {
      const rect = panel.getBoundingClientRect();

      localStorage.setItem(
        CONFIG.storageKey,
        JSON.stringify({
          x: rect.left,
          y: rect.top
        })
      );
    } catch (error) {
      console.warn('Position save failed:', error);
    }
  }

  /**
   * Restores the previously saved panel position.
   *
   * @param {HTMLElement} panel
   * @returns {void}
   */
  function restorePosition(panel) {
    try {
      const saved = localStorage.getItem(
        CONFIG.storageKey
      );

      if (!saved) return;

      const { x, y } = JSON.parse(saved);

      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y)
      ) return;

      const maxX = Math.max(
        0,
        window.innerWidth - panel.offsetWidth
      );

      const maxY = Math.max(
        0,
        window.innerHeight - panel.offsetHeight
      );

      panel.style.left =
        Math.max(0, Math.min(x, maxX)) + 'px';

      panel.style.top =
        Math.max(0, Math.min(y, maxY)) + 'px';

      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    } catch (error) {
      console.warn('Position restore failed:', error);
    }
  }

  /**
   * Makes the panel draggable by its header.
   *
   * @param {HTMLElement} panel
   * @param {HTMLElement} handle
   * @returns {void}
   */
  function makeDraggable(panel, handle) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.style.cursor = 'grab';
    handle.style.userSelect = 'none';
    handle.style.touchAction = 'none';

    handle.addEventListener('pointerdown', event => {
      if (
        event.button !== 0 ||
        event.target.closest('button')
      ) return;

      const rect = panel.getBoundingClientRect();

      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';

      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;

      dragging = true;
      handle.style.cursor = 'grabbing';

      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener('pointermove', event => {
      if (!dragging) return;

      const maxX = Math.max(
        0,
        window.innerWidth - panel.offsetWidth
      );

      const maxY = Math.max(
        0,
        window.innerHeight - panel.offsetHeight
      );

      panel.style.left = Math.max(
        0,
        Math.min(event.clientX - offsetX, maxX)
      ) + 'px';

      panel.style.top = Math.max(
        0,
        Math.min(event.clientY - offsetY, maxY)
      ) + 'px';
    });

    const stop = () => {
      if (!dragging) return;

      dragging = false;
      handle.style.cursor = 'grab';

      savePosition(panel);
    };

    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('lostpointercapture', stop);
  }

  // ================================================
  // USER INTERFACE
  // ================================================

  /**
   * Creates the floating grading controls and
   * integrated diagnostic drawer.
   *
   * @returns {void}
   */
  function addControls() {
    if (document.getElementById(CONFIG.panelId)) {
      return;
    }

    const panel = document.createElement('div');
    panel.id = CONFIG.panelId;

    Object.assign(panel.style, {
      position: 'fixed',
      right: '20px',
      bottom: '20px',
      zIndex: '2147483646',
      background: '#202b38',
      padding: '12px',
      borderRadius: '10px',
      boxShadow: '0 4px 16px #0005',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      fontFamily: 'Arial, sans-serif',
      color: 'white',
      width: '240px',
      maxHeight: '85vh',
      overflowY: 'auto',
      boxSizing: 'border-box'
    });

    // Header and diagnostic toggle

    const header = document.createElement('div');

    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      background: '#35465a',
      padding: '7px 8px',
      borderRadius: '6px',
      fontWeight: 'bold',
      fontSize: '13px'
    });

    const title = document.createElement('span');
    title.textContent = '⠿ Rubric Helper v3.5';

    const toggle = document.createElement('button');
    toggle.id = 'tm-rubric-diagnostic-toggle';
    toggle.type = 'button';
    toggle.textContent = '🩺';
    toggle.title = 'Enable diagnostics';
    toggle.setAttribute(
      'aria-label',
      'Toggle diagnostics'
    );
    toggle.setAttribute('aria-pressed', 'false');

    Object.assign(toggle.style, {
      border: 'none',
      background: '#d1d5db',
      color: '#1f2937',
      borderRadius: '5px',
      padding: '5px 7px',
      cursor: 'pointer'
    });

    toggle.addEventListener('click', () => {
      setDiagnostics(!diagnosticsEnabled);
    });

    header.append(title, toggle);
    panel.appendChild(header);

    /**
     * Creates a grading action button.
     *
     * @param {string} label
     * @param {Function} action
     * @param {string} color
     * @returns {HTMLButtonElement}
     */
    function makeButton(label, action, color) {
      const button = document.createElement('button');

      button.type = 'button';
      button.textContent = label;
      button.dataset.rubricAction = 'true';

      Object.assign(button.style, {
        padding: '10px 12px',
        border: 'none',
        borderRadius: '6px',
        background: color,
        color: 'white',
        fontWeight: 'bold',
        fontSize: '13px',
        cursor: 'pointer'
      });

      button.addEventListener('click', () => {
        runAction(action);
      });

      return button;
    }

    panel.appendChild(makeButton(
      'Max All Criteria',
      maximizeRubric,
      '#2877c7'
    ));

    panel.appendChild(makeButton(
      'Max + Submit',
      maxAndSubmit,
      '#24854b'
    ));

    panel.appendChild(makeButton(
      'Max + Submit + Next',
      maxSubmitNext,
      '#8559c7'
    ));

    panel.appendChild(makeButton(
      'Submit Rubric',
      submitRubric,
      '#666666'
    ));

    // Status display

    const status = document.createElement('div');
    status.id = 'tm-rubric-status';
    status.textContent = 'Ready — all criteria included';

    Object.assign(status.style, {
      fontSize: '12px',
      lineHeight: '1.4',
      textAlign: 'center',
      color: '#d5e0ea'
    });

    panel.appendChild(status);

    // Diagnostic drawer

    const diagnostics = document.createElement('div');
    diagnostics.id = 'tm-rubric-diagnostic-panel';
    diagnostics.hidden = true;

    diagnostics.style.borderTop =
      '1px solid #637082';
    diagnostics.style.paddingTop = '8px';

    const diagnosticTitle = document.createElement('div');
    diagnosticTitle.textContent =
      'Diagnostics — last 50 events';
    diagnosticTitle.style.marginBottom = '6px';

    const output = document.createElement('textarea');
    output.id = 'tm-rubric-diagnostic-output';
    output.readOnly = true;

    Object.assign(output.style, {
      width: '100%',
      height: '135px',
      boxSizing: 'border-box',
      fontFamily: 'monospace',
      fontSize: '10px',
      resize: 'vertical'
    });

    const actions = document.createElement('div');

    Object.assign(actions.style, {
      display: 'flex',
      gap: '6px',
      marginTop: '6px'
    });

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy Report';

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Clear Log';

    for (const button of [copy, clear]) {
      Object.assign(button.style, {
        flex: '1',
        padding: '7px 3px',
        cursor: 'pointer',
        border: 'none',
        borderRadius: '4px',
        fontSize: '11px'
      });
    }

    copy.addEventListener('click', async () => {
      const report = buildReport();

      try {
        await navigator.clipboard.writeText(report);
        setStatus('Diagnostic report copied.');
      } catch (error) {
        output.value = report;
        output.select();
        setStatus('Report selected — press Ctrl+C.');
      }
    });

    clear.addEventListener('click', () => {
      events = [];
      renderLog();
      setStatus('Diagnostic log cleared.');
    });

    actions.append(copy, clear);

    diagnostics.append(
      diagnosticTitle,
      output,
      actions
    );

    panel.appendChild(diagnostics);
    document.body.appendChild(panel);

    makeDraggable(panel, header);
    restorePosition(panel);
  }

  // ================================================
  // INITIALIZATION
  // ================================================

  if (document.body) {
    addControls();
  } else {
    document.addEventListener(
      'DOMContentLoaded',
      addControls,
      { once: true }
    );
  }
})();
