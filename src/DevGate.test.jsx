// @vitest-environment jsdom
//
// Real ask: visitors see "under development, available soon"; only testers
// with the password get in. The REAL password must never appear in this repo,
// so every test here uses a made-up one and passes in its hash.
import { describe, test, expect, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DevGate, sha256Hex, TESTER_PASSWORD_HASH } from "./DevGate.jsx";

const TEST_PASSWORD = "correct-horse-test";
const TEST_HASH = "efeedfae30aad25f0ad201923046c51e40a65030cdb4b85603897d6cdc2c7c38";

function renderGate(props = {}) {
  return render(
    <DevGate enabled passwordHash={TEST_HASH} {...props}>
      <div>THE REAL APP</div>
    </DevGate>
  );
}

describe("<DevGate />", () => {
  beforeEach(() => { try { localStorage.clear(); } catch (e) {} });

  test("a visitor sees the under-development message, not the app", () => {
    renderGate();
    expect(screen.getByText("This site is under development and will be available soon.")).toBeInTheDocument();
    expect(screen.getByLabelText("If you're a tester, enter the password")).toBeInTheDocument();
    expect(screen.queryByText("THE REAL APP")).not.toBeInTheDocument();
  });

  test("the wrong password is refused and the app stays hidden", async () => {
    const user = userEvent.setup();
    renderGate();
    await user.type(screen.getByLabelText("If you're a tester, enter the password"), "guess");
    await user.click(screen.getByText("Enter"));
    expect(await screen.findByRole("alert")).toHaveTextContent("That's not the right password.");
    expect(screen.queryByText("THE REAL APP")).not.toBeInTheDocument();
  });

  test("the right password lets a tester in", async () => {
    const user = userEvent.setup();
    renderGate();
    await user.type(screen.getByLabelText("If you're a tester, enter the password"), TEST_PASSWORD);
    await user.click(screen.getByText("Enter"));
    expect(await screen.findByText("THE REAL APP")).toBeInTheDocument();
  });

  test("it's case-sensitive", async () => {
    const user = userEvent.setup();
    renderGate();
    await user.type(screen.getByLabelText("If you're a tester, enter the password"), TEST_PASSWORD.toUpperCase());
    await user.click(screen.getByText("Enter"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  test("a trailing space from a phone keyboard doesn't lock a tester out", async () => {
    const user = userEvent.setup();
    renderGate();
    await user.type(screen.getByLabelText("If you're a tester, enter the password"), TEST_PASSWORD + " ");
    await user.click(screen.getByText("Enter"));
    expect(await screen.findByText("THE REAL APP")).toBeInTheDocument();
  });

  test("once unlocked, a tester isn't asked again on this device", async () => {
    const user = userEvent.setup();
    const { unmount } = renderGate();
    await user.type(screen.getByLabelText("If you're a tester, enter the password"), TEST_PASSWORD);
    await user.click(screen.getByText("Enter"));
    await screen.findByText("THE REAL APP");
    unmount();
    renderGate();
    expect(screen.getByText("THE REAL APP")).toBeInTheDocument();
  });

  test("turning it off at launch shows the app to everyone", () => {
    renderGate({ enabled: false });
    expect(screen.getByText("THE REAL APP")).toBeInTheDocument();
  });

  test("the hash function matches standard SHA-256", async () => {
    expect(await sha256Hex(TEST_PASSWORD)).toBe(TEST_HASH);
  });

  test("the shipped hash is a real SHA-256 hash, not a plaintext password", () => {
    expect(TESTER_PASSWORD_HASH).toMatch(/^[0-9a-f]{64}$/);
  });
});
