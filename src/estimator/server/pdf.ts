import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import Decimal from "decimal.js";
import type { Proposal } from "../domain/proposal";
export async function proposalPDF(p: Proposal) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const hex = /^#[\da-f]{6}$/i.test(p.company.color)
    ? p.company.color
    : "#172b30";
  const color = rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );
  let page = pdf.addPage([612, 792]);
  let y = 738;
  let pageNumber = 0;
  const clean = (text: string) => text.replace(/[^\x20-\x7e\xa0-\xff\n]/g, "?");
  function footer() {
    page.drawText(
      `FLIPAS HOME REMODELING  |  ${p.number}  |  Page ${++pageNumber}`,
      { x: 44, y: 26, size: 8, font, color: rgb(0.4, 0.4, 0.4) },
    );
  }
  function space(amount: number) {
    if (y - amount < 56) {
      footer();
      page = pdf.addPage([612, 792]);
      y = 738;
    }
  }
  function line(text: string, size = 10, strong = false) {
    const f = strong ? bold : font;
    const words = clean(text).split(/\s+/);
    let row = "";
    for (const word of words) {
      let rest = word;
      while (f.widthOfTextAtSize(rest, size) > 524) {
        const part = rest.slice(0, 55);
        if (row) {
          space(size + 6);
          page.drawText(row, { x: 44, y, size, font: f, color });
          y -= size + 6;
          row = "";
        }
        space(size + 6);
        page.drawText(part, { x: 44, y, size, font: f, color });
        y -= size + 6;
        rest = rest.slice(55);
      }
      const next = row ? `${row} ${rest}` : rest;
      if (f.widthOfTextAtSize(next, size) > 524) {
        space(size + 6);
        page.drawText(row, { x: 44, y, size, font: f, color });
        y -= size + 6;
        row = rest;
      } else row = next;
    }
    if (row) {
      space(size + 6);
      page.drawText(row, { x: 44, y, size, font: f, color });
      y -= size + 6;
    }
  }
  function block(title: string, text: string) {
    space(44);
    y -= 12;
    line(title, 12, true);
    for (const row of text.split("\n")) line(row || " ");
  }
  line(p.company.name, 22, true);
  line(p.company.contact || "[Business contact information pending]");
  y -= 12;
  if (p.draft) line("DRAFT / INTERNAL PREVIEW - NOT RELEASED", 12, true);
  line(`Proposal ${p.number} | Revision ${p.revision}`, 14, true);
  line(`Prepared for ${p.customer.name}`);
  line([p.customer.email, p.customer.phone].filter(Boolean).join(" | "));
  line(p.address);
  line(`Valid through: ${p.expiresAt}`);
  block("Scope of work", p.scope || "[Scope pending]");
  for (const sec of p.sections) {
    block(sec.name, "");
    for (const item of sec.lines) {
      line(
        `${item.name} | ${item.quantity} ${item.unit} x $${item.unitPrice} = $${item.price}`,
        10,
        true,
      );
      if (item.description) line(item.description);
    }
  }
  block(
    "Total investment",
    `Discount: $${p.discount}\nNet selling price: $${p.netPrice}\nConfigured tax: $${p.tax}\nTOTAL: $${p.total}`,
  );
  if (p.durationDays)
    line(
      `Estimated project duration: ${p.durationDays} days (subject to the reviewed proposal terms)`,
    );
  block(
    "Payment milestones",
    p.milestones.length
      ? p.milestones
          .map(
            (m) =>
              `${m.label}: ${new Decimal(m.percentage).mul(100).toString()}%`,
          )
          .join("\n")
      : "[Payment milestones pending]",
  );
  block("Inclusions", p.inclusions || "[Inclusions pending]");
  block("Exclusions", p.exclusions || "[Exclusions pending]");
  block(
    "Terms and conditions",
    p.company.terms || "[Terms require business-owner review]",
  );
  block(
    "Customer acceptance",
    "Name: ______________________________\nSignature: ___________________________\nDate: _______________________________",
  );
  footer();
  pdf.setTitle(`${p.company.name} Proposal ${p.number}`);
  pdf.setAuthor(p.company.name);
  return pdf.save();
}
