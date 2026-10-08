import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How pick-up works" };

const Q = ({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) => (
  <section id={id} className="glass scroll-mt-24 rounded-xl p-6">
    <h2 className="text-xl">{title}</h2>
    <div className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
  </section>
);

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-[clamp(1.8rem,3.5vw,2.5rem)] font-extrabold">How the MCCIA Store works</h1>
        <p className="mt-2 text-muted-foreground">We do not deliver. You order online and collect from the MCCIA branch you choose — so you always know exactly where your order is.</p>
      </div>
      <Q title="Ordering and pick-up">
        <p>Add products to your cart, then choose one of our five branches at checkout. You can see how many of each item that branch has before you order. When you place the order we reserve the items at that branch and e-mail you the invoice.</p>
        <p>When your order is packed we e-mail you again. Show the invoice (on your phone is fine) at the branch and take your order home.</p>
      </Q>
      <Q id="payment" title="Payment options">
        <p><strong className="text-foreground">Pay at pick-up</strong> — pay at the branch counter when you collect, by cash or by UPI / card through Razorpay. Nothing is charged online.</p>
        <p><strong className="text-foreground">Pay online</strong> — through Razorpay: UPI, cards and net banking. Coming soon.</p>
        <p>Prices on the website are shown before GST, with the GST-inclusive price in brackets underneath. Your invoice shows the GST in full.</p>
      </Q>
      <Q title="Changes, cancellations and holding time">
        <p>Orders are held for a few days. If an order is not collected in time it is released so someone else can buy the items, and we e-mail you. You can cancel an unpaid order yourself from its page, or call the branch.</p>
      </Q>
      <Q id="privacy" title="Privacy and contact">
        <p>We use your name, phone number and e-mail only to prepare and hand over your order and to send your invoice. We do not sell your data. Sign-in uses one-time e-mail codes, so there is no password to lose.</p>
        <p>Questions? Visit any <Link href="/store/cart" className="font-semibold text-primary">pick-up branch</Link> or write to the MCCIA office at MCCIA Trade Tower, Senapati Bapat Road, Pune 411 016.</p>
      </Q>
    </div>
  );
}
