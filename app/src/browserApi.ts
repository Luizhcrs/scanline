import { invoke } from "./api";

/**
 * Scriptable browser API (the agent-browser surface) on top of the proven CDP
 * bridge. Most verbs inject JS via Runtime.evaluate (robust, no node-id
 * plumbing); snapshot tags interactive elements with data-scanline-ref="eN" so
 * click/fill/type/etc target them by ref (or by a raw CSS selector). Trusted
 * input (press) and cookies/viewport use real CDP domains.
 */
export interface BrowserResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

async function cdp(sid: number, method: string, params: object): Promise<any> {
  const raw = await invoke<string>("browser_cdp", {
    id: sid,
    method,
    params: JSON.stringify(params),
  });
  return JSON.parse(raw);
}

/** Evaluate a function BODY (must `return`) in the page; returns the value. */
async function evalBody(sid: number, body: string): Promise<any> {
  const o = await cdp(sid, "Runtime.evaluate", {
    expression: `(()=>{${body}})()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (o.exceptionDetails) {
    throw new Error(
      o.exceptionDetails.exception?.description || o.exceptionDetails.text || "eval error",
    );
  }
  return o.result?.value;
}

/** A bare ref ("e3") becomes a [data-scanline-ref] selector; else it's CSS. */
function sel(refOrCss: string): string {
  return /^e\d+$/.test(refOrCss) ? `[data-scanline-ref="${refOrCss}"]` : refOrCss;
}

const SNAPSHOT_BODY = `
  const sels='a,button,input,textarea,select,summary,[role=button],[role=link],[role=textbox],[role=checkbox],[role=tab],[role=menuitem],[onclick],[contenteditable=true]';
  const seen=new Set();const out=[];let i=0;
  for(const el of document.querySelectorAll(sels)){
    if(seen.has(el))continue;seen.add(el);
    const r=el.getBoundingClientRect();
    if(r.width<1||r.height<1)continue;
    const cs=getComputedStyle(el);
    if(cs.visibility==='hidden'||cs.display==='none')continue;
    const ref='e'+(++i);el.setAttribute('data-scanline-ref',ref);
    const tag=el.tagName.toLowerCase();
    const label=(el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.value||el.innerText||el.getAttribute('alt')||el.getAttribute('title')||'').replace(/\\s+/g,' ').trim().slice(0,100);
    out.push(ref+' <'+tag+'> '+label);
  }
  return out.join('\\n');
`;

// CDP key params for trusted Input.dispatchKeyEvent.
const KEYMAP: Record<string, [number, string]> = {
  enter: [13, "Enter"],
  tab: [9, "Tab"],
  escape: [27, "Escape"],
  backspace: [8, "Backspace"],
  delete: [46, "Delete"],
  up: [38, "ArrowUp"],
  down: [40, "ArrowDown"],
  left: [37, "ArrowLeft"],
  right: [39, "ArrowRight"],
  home: [36, "Home"],
  end: [35, "End"],
};

async function pressKey(sid: number, key: string): Promise<void> {
  const m = KEYMAP[key.toLowerCase()];
  const base = m
    ? { key: m[1], code: m[1], windowsVirtualKeyCode: m[0], nativeVirtualKeyCode: m[0] }
    : { key, text: key };
  await cdp(sid, "Input.dispatchKeyEvent", { type: "keyDown", ...base });
  await cdp(sid, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

export async function browserDispatch(
  sid: number,
  verb: string,
  args: string[],
): Promise<BrowserResult> {
  const a0 = args[0] ?? "";
  const rest = args.slice(1).join(" ");
  const sj = (s: string) => JSON.stringify(sel(s));
  const J = JSON.stringify;

  switch (verb) {
    case "eval":
      return { ok: true, result: await evalBody(sid, `return (${args.join(" ") || "null"})`) };
    case "snapshot":
      return { ok: true, result: await evalBody(sid, SNAPSHOT_BODY) };
    case "url":
      return { ok: true, result: await evalBody(sid, "return location.href") };
    case "text": {
      const body = a0
        ? `const e=document.querySelector(${sj(a0)});return e?e.innerText:null;`
        : "return document.body?document.body.innerText:'';";
      return { ok: true, result: await evalBody(sid, body) };
    }
    case "html": {
      const body = a0
        ? `const e=document.querySelector(${sj(a0)});return e?e.outerHTML:null;`
        : "return document.documentElement.outerHTML;";
      return { ok: true, result: await evalBody(sid, body) };
    }
    case "value":
      return {
        ok: true,
        result: await evalBody(sid, `const e=document.querySelector(${sj(a0)});return e?e.value:null;`),
      };
    case "attr":
      return {
        ok: true,
        result: await evalBody(
          sid,
          `const e=document.querySelector(${sj(a0)});return e?e.getAttribute(${J(args[1] ?? "")}):null;`,
        ),
      };
    case "count":
      return {
        ok: true,
        result: await evalBody(sid, `return document.querySelectorAll(${J(a0)}).length;`),
      };
    case "exists":
      return { ok: true, result: await evalBody(sid, `return !!document.querySelector(${sj(a0)});`) };
    case "visible":
      return {
        ok: true,
        result: await evalBody(
          sid,
          `const e=document.querySelector(${sj(a0)});if(!e)return false;const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none';`,
        ),
      };
    case "checked":
      return {
        ok: true,
        result: await evalBody(sid, `const e=document.querySelector(${sj(a0)});return e?!!e.checked:null;`),
      };
    case "find": {
      // locate an element by visible text, tag it, return its ref
      const ref = await evalBody(
        sid,
        `const t=${J(args.join(" "))}.toLowerCase();const els=[...document.querySelectorAll('a,button,input,[role],summary,label,li,span,div')];for(const el of els){const s=(el.innerText||el.value||el.getAttribute('aria-label')||'').trim().toLowerCase();if(s&&s.includes(t)){const r=el.getBoundingClientRect();if(r.width<1)continue;const ref='e'+Math.floor(Math.random()*1e6);el.setAttribute('data-scanline-ref',ref);return ref;}}return null;`,
      );
      return ref ? { ok: true, result: ref } : { ok: false, error: `no element matching ${args.join(" ")}` };
    }
    case "click": {
      const ok = await evalBody(
        sid,
        `const e=document.querySelector(${sj(a0)});if(!e)return false;e.scrollIntoView({block:'center'});e.click();return true;`,
      );
      return ok ? { ok: true } : { ok: false, error: `no element ${a0}` };
    }
    case "fill":
    case "type": {
      // Use the native value setter so React/Vue controlled inputs register the
      // change (assigning e.value directly is reverted by their value tracker).
      const ok = await evalBody(
        sid,
        `const e=document.querySelector(${sj(a0)});if(!e)return false;e.focus();` +
          `const proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;` +
          `const set=Object.getOwnPropertyDescriptor(proto,'value').set;` +
          `set?set.call(e,${J(rest)}):(e.value=${J(rest)});` +
          `e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;`,
      );
      return ok ? { ok: true } : { ok: false, error: `no element ${a0}` };
    }
    case "check":
    case "uncheck": {
      const want = verb === "check";
      const ok = await evalBody(
        sid,
        `const e=document.querySelector(${sj(a0)});if(!e)return false;if(e.checked!==${want}){e.click();}return true;`,
      );
      return ok ? { ok: true } : { ok: false, error: `no element ${a0}` };
    }
    case "select": {
      const ok = await evalBody(
        sid,
        `const e=document.querySelector(${sj(a0)});if(!e)return false;e.value=${J(rest)};e.dispatchEvent(new Event('change',{bubbles:true}));return true;`,
      );
      return ok ? { ok: true } : { ok: false, error: `no element ${a0}` };
    }
    case "scroll": {
      const body = a0
        ? `const e=document.querySelector(${sj(a0)});if(e)e.scrollIntoView({block:'center'});return !!e;`
        : "window.scrollBy(0,window.innerHeight*0.8);return true;";
      await evalBody(sid, body);
      return { ok: true };
    }
    case "press":
      await pressKey(sid, a0);
      return { ok: true };
    case "wait": {
      const deadline = Date.now() + 10000;
      const css = sj(a0);
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (await evalBody(sid, `return !!document.querySelector(${css});`)) return { ok: true };
        if (Date.now() > deadline) return { ok: false, error: `timeout waiting for ${a0}` };
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    case "zoom": {
      const f = a0 || "1";
      await evalBody(sid, `document.body.style.zoom=${J(f)};return true;`);
      return { ok: true };
    }
    case "screenshot": {
      const o = await cdp(sid, "Page.captureScreenshot", { format: "png" });
      return { ok: true, result: { data: o.data ?? "" } };
    }
    case "cookies": {
      if (a0 === "clear") {
        await cdp(sid, "Network.clearBrowserCookies", {});
        return { ok: true };
      }
      await cdp(sid, "Network.enable", {});
      const o = await cdp(sid, "Network.getCookies", {});
      return { ok: true, result: o.cookies ?? [] };
    }
    case "storage": {
      // storage get [key] | set <key> <value> | clear  (localStorage)
      const sub = a0;
      if (sub === "set") {
        await evalBody(sid, `localStorage.setItem(${J(args[1] ?? "")},${J(args.slice(2).join(" "))});return true;`);
        return { ok: true };
      }
      if (sub === "clear") {
        await evalBody(sid, "localStorage.clear();return true;");
        return { ok: true };
      }
      const body = args[1]
        ? `return localStorage.getItem(${J(args[1])});`
        : "return Object.fromEntries(Object.entries(localStorage));";
      return { ok: true, result: await evalBody(sid, body) };
    }
    case "viewport": {
      const w = parseInt(a0 || "1280", 10);
      const h = parseInt(args[1] || "800", 10);
      await cdp(sid, "Emulation.setDeviceMetricsOverride", {
        width: w,
        height: h,
        deviceScaleFactor: 1,
        mobile: false,
      });
      return { ok: true };
    }
    case "devtools":
      await invoke("browser_devtools", { id: sid });
      return { ok: true };
    case "navigate":
      await invoke("browser_navigate", { id: sid, url: a0 });
      return { ok: true };
    case "back":
      await invoke("browser_back", { id: sid });
      return { ok: true };
    case "forward":
      await invoke("browser_forward", { id: sid });
      return { ok: true };
    case "reload":
      await evalBody(sid, "location.reload();return true;");
      return { ok: true };
    default:
      return { ok: false, error: `unknown browser verb ${verb}` };
  }
}
