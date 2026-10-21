"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { LOI_CHOICES, TALK_LIMITS, fetchTalkCount, submitTalk, validateTalk, type TalkErrors, type TalkForm } from "@/lib/talk";
import { cn } from "@/lib/utils";
import { VAULTS } from "@/lib/vaults";

const EMPTY: TalkForm = { holds: "", today: "", blocker: "", yield: "", loi: "", handle: "", consent: false };

type Phase = { name: "idle" } | { name: "sending" } | { name: "failed"; message: string } | { name: "done" };

const QUESTIONS = [
  { field: "holds", label: "What do you hold, or LP, on Robinhood Chain today?", help: "Tokens and a rough size, like NVDA and about $3k. Write none if none." },
  { field: "today", label: "What do you do with it today?", help: "The last thing you did after buying: left it in the wallet, LP'd by hand, lent it, something else." },
  { field: "blocker", label: "What stops you from LPing it?", help: "The real reason, even if it feels small." },
  { field: "yield", label: "What yield would make you deposit?", help: "A yearly number you keep after losses to fast traders, if you have one in mind." },
] as const;

const LOI_LABEL = { yes: "Yes", maybe: "Maybe", no: "No" } as const;

const fieldBox = "w-full rounded-lg border border-line bg-canvas px-3 text-[15px] leading-6 outline-none placeholder:text-mute focus:border-fg disabled:opacity-60 aria-[invalid=true]:border-fg";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-2 flex items-start gap-2 text-[13px] leading-5 text-fg">
      <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

export function TalkInterview() {
  const [form, setForm] = useState<TalkForm>(EMPTY);
  const [errors, setErrors] = useState<TalkErrors>({});
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [count, setCount] = useState<number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const sending = phase.name === "sending";

  useEffect(() => {
    let live = true;
    fetchTalkCount().then((n) => {
      if (live) setCount(n);
    });
    return () => {
      live = false;
    };
  }, []);

  const done = phase.name === "done";
  useEffect(() => {
    if (done) heading.current?.focus();
  }, [done]);

  const set = <K extends keyof TalkForm>(key: K, value: TalkForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
    if (phase.name === "failed") setPhase({ name: "idle" });
  };

  const focusField = (field: keyof TalkForm) => document.getElementById(field === "loi" ? `talk-loi-${LOI_CHOICES[0]}` : `talk-${field}`)?.focus();

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const found = validateTalk(form);
    setErrors(found);
    const first = (Object.keys(found) as (keyof TalkForm)[])[0];
    if (first) {
      focusField(first);
      return;
    }
    setPhase({ name: "sending" });
    const out = await submitTalk(form);
    if (out.ok) {
      setPhase({ name: "done" });
      setForm(EMPTY);
      return;
    }
    if (out.field) {
      setErrors({ [out.field]: out.message });
      focusField(out.field);
    }
    setPhase({ name: "failed", message: out.message });
  };

  return (
    <section aria-labelledby="talk-title" className="max-w-[690px]">
      <header>
        <h1 id="talk-title" ref={heading} tabIndex={-1} className="serif text-[30px] font-normal leading-[34px] outline-none sm:text-[44px] sm:leading-[48px]">
          {done ? "Thank you. Your answers are in." : "Five questions about what your Stock Tokens do all day."}
        </h1>
        <p className="mt-5 text-[18px] leading-7 text-mute">
          {done
            ? "We read every answer. If you said yes or maybe and left a handle, we send the one page note from the last question."
            : "About three minutes. No wallet, no sign-in. Your answers shape what Uptick builds next."}
        </p>
        {count !== null && count > 0 ? (
          <p className="figure mt-3 text-[13px] leading-5 text-mute">{count === 1 ? "1 person has answered." : `${count} people have answered.`}</p>
        ) : null}
      </header>

      {done ? (
        <div className="mt-10 flex items-center gap-3 border-t border-hairline pt-6 text-[15px]">
          <CheckCircle size={20} weight="fill" className="shrink-0 text-kept" aria-hidden="true" />
          <Link href="/vaults" className="underline underline-offset-4">See the {VAULTS.length} ranked Stock Token vaults</Link>
        </div>
      ) : (
        <form onSubmit={send} noValidate className="mt-10" aria-busy={sending}>
          {QUESTIONS.map((q, i) => {
            const limit = TALK_LIMITS[q.field];
            const left = limit - form[q.field].length;
            const err = errors[q.field];
            return (
              <div key={q.field} className="border-t border-hairline py-6">
                <label htmlFor={`talk-${q.field}`} className="block text-[17px] font-semibold leading-6 tracking-[-0.1px]">
                  <span className="text-mute">{i + 1}. </span>
                  {q.label}
                </label>
                <p id={`talk-${q.field}-help`} className="mt-1 text-[13px] leading-5 text-mute">{q.help}</p>
                <textarea
                  id={`talk-${q.field}`}
                  value={form[q.field]}
                  maxLength={limit}
                  rows={3}
                  disabled={sending}
                  onChange={(e) => set(q.field, e.target.value)}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={`talk-${q.field}-help${err ? ` talk-${q.field}-err` : ""}`}
                  className={cn(fieldBox, "mt-3 block resize-y py-2.5")}
                />
                <div className="flex items-start justify-between gap-4">
                  <FieldError id={`talk-${q.field}-err`} message={err} />
                  <p className="figure ml-auto mt-2 shrink-0 text-[12px] leading-5 text-mute" aria-hidden="true">{left} left</p>
                </div>
              </div>
            );
          })}

          <fieldset className="border-t border-hairline py-6" aria-describedby="talk-loi-help" disabled={sending}>
            <legend className="float-left w-full text-[17px] font-semibold leading-6 tracking-[-0.1px]">
              <span className="text-mute">5. </span>
              Would you sign a non-binding letter of intent to deposit at launch?
            </legend>
            <p id="talk-loi-help" className="clear-both pt-1 text-[13px] leading-5 text-mute">One page: a token, a size and your conditions. It commits no money and you can withdraw it any time.</p>
            <div className="mt-3 flex gap-2">
              {LOI_CHOICES.map((c) => (
                <label key={c} className="relative">
                  <input
                    id={`talk-loi-${c}`}
                    type="radio"
                    name="loi"
                    value={c}
                    checked={form.loi === c}
                    onChange={() => set("loi", c)}
                    className="peer sr-only"
                  />
                  <span className="press flex h-11 min-w-[88px] cursor-pointer select-none items-center justify-center rounded-full border border-line px-5 text-[15px] font-semibold text-mute hover:bg-panel hover:text-fg peer-checked:border-fg peer-checked:bg-fg peer-checked:text-canvas peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-fg peer-disabled:opacity-40">
                    {LOI_LABEL[c]}
                  </span>
                </label>
              ))}
            </div>
            <FieldError id="talk-loi-err" message={errors.loi} />
          </fieldset>

          <div className="border-t border-hairline py-6">
            <label htmlFor="talk-handle" className="block text-[17px] font-semibold leading-6 tracking-[-0.1px]">Your X handle <span className="font-normal text-mute">(optional)</span></label>
            <p id="talk-handle-help" className="mt-1 text-[13px] leading-5 text-mute">Only if you want a reply. Leave it empty to stay anonymous.</p>
            <input
              id="talk-handle"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={form.handle}
              maxLength={TALK_LIMITS.handle + 1}
              disabled={sending}
              onChange={(e) => set("handle", e.target.value)}
              aria-invalid={errors.handle ? true : undefined}
              aria-describedby={`talk-handle-help${errors.handle ? " talk-handle-err" : ""}`}
              className={cn(fieldBox, "mt-3 h-11 max-w-[320px]")}
            />
            <FieldError id="talk-handle-err" message={errors.handle} />
          </div>

          <div className="border-t border-hairline py-6">
            <label htmlFor="talk-consent" className="flex cursor-pointer items-start gap-3 text-[15px] leading-6">
              <input
                id="talk-consent"
                type="checkbox"
                checked={form.consent}
                disabled={sending}
                onChange={(e) => set("consent", e.target.checked)}
                aria-invalid={errors.consent ? true : undefined}
                aria-describedby={errors.consent ? "talk-consent-err" : undefined}
                className="mt-1 size-5 shrink-0 cursor-pointer accent-[var(--color-fg)]"
              />
              <span>Uptick may store these answers, and my handle if I typed one, to decide what to build. No wallet address or email is collected.</span>
            </label>
            <FieldError id="talk-consent-err" message={errors.consent} />
          </div>

          <div className="border-t border-hairline pt-6">
            <Button type="submit" size="lg" disabled={sending}>
              {sending ? (
                <>
                  <CircleNotch size={18} className="motion-safe:animate-spin" aria-hidden="true" />
                  Sending
                </>
              ) : (
                "Send answers"
              )}
            </Button>
            <div role="status" aria-live="polite" className="mt-4 min-h-6">
              {phase.name === "failed" ? <FieldError id="talk-send-err" message={phase.message} /> : null}
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
