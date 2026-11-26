import { test, expect } from "@playwright/test";

test("a guest reads both PDF pages and downloads the original", async ({ page }) => {
  const book = { id: "reader", title: "Idoma greetings", author: "Oche", uploaded_by: "oche", has_file: true, mime: "application/pdf", file_url: "/api/library/reader/file" };
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += "xref\n0 5\n0000000000 65535 f \n" + offsets.map(n => String(n).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await page.route(url => url.pathname.startsWith("/api/"), route => {
    const url = new URL(route.request().url());
    if (url.pathname === book.file_url) return route.fulfill({body: pdf, contentType: "application/pdf", headers: {"Content-Disposition": url.search ? "inline" : 'attachment; filename="greetings.pdf"'}});
    return route.fulfill({json: url.pathname === "/api/library" ? {items: [book], total: 1} : url.pathname === "/api/library/reader" ? book : {}});
  });
  await page.goto("/");
  await page.getByRole("button", {name: "E-Library"}).click();
  await page.getByRole("button", {name: "Read", exact: true}).click();
  await expect(page.getByText("Page 1 of 2")).toBeVisible();
  await page.getByRole("button", {name: "Next"}).click();
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", {name: "Download original"}).click();
  expect((await download).suggestedFilename()).toBe("greetings.pdf");
});
