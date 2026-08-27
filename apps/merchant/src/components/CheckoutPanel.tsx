"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SheetSession } from "@/lib/checkout-session.js";
import type { DcApiForm } from "@/lib/transport.js";
import { CheckoutForm } from "./CheckoutForm.js";
import { PaymentScreen } from "./PaymentScreen.js";

/**
 * The checkout page and its payment sheet, in one client component.
 *
 * The sheet used to live on its own route, `/pay/[sessionId]`, which rendered it
 * over an empty page — so its scrim dimmed nothing and it read as a modal over a
 * blank document, because it was one. Here the form and the basket stay mounted
 * behind it, which is what a hosted payment sheet actually feels like and is why
 * the scrim could be lightened to 28%.
 *
 * The session id is mirrored into `?session=` with `replace`, not `push`: Back
 * should return to /cart, not to a checkout form whose order already exists.
 * That parameter is also what survives a coarse-pointer wallet handover, which
 * navigates the tab away entirely (see lib/checkout-session.ts).
 */
export function CheckoutPanel({
  initialSession,
  merchantName,
  dcApiForm,
}: {
  initialSession: SheetSession | null;
  merchantName: string;
  /** Resolved from `?dcapi=` by the page; the form needs it before first paint. */
  dcApiForm: DcApiForm;
}) {
  const router = useRouter();
  const [session, setSession] = useState<SheetSession | null>(initialSession);

  return (
    <>
      {/*
        `inert` while the sheet is open: real focusable content sits behind an
        aria-modal dialog, and a shopper must not be able to Tab into the form
        they are currently being asked to pay for.
      */}
      <div inert={session ? true : undefined}>
        <CheckoutForm
          dcApiForm={dcApiForm}
          onSessionStarted={(started) => {
            setSession(started);
            router.replace(`/checkout?session=${started.sessionId}`);
          }}
        />
      </div>

      {session ? (
        <PaymentScreen
          {...session}
          merchantName={merchantName}
          onClose={() => {
            setSession(null);
            router.replace("/checkout");
          }}
        />
      ) : null}
    </>
  );
}
