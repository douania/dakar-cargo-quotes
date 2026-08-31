import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FinalRequestAssertionEditor } from "../FinalRequestAssertionEditor";

const SOURCE = {
  id: "source-version-1",
  kind: "email",
  authorRole: "client",
  roleVerified: true,
  contentClass: "current",
  sentAt: "2026-08-30T10:00:00Z",
  text: "Merci de retenir un poids total de 1200 kg pour cette expédition.",
};

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    setPointerCapture: { configurable: true, value: () => undefined },
    releasePointerCapture: { configurable: true, value: () => undefined },
    scrollIntoView: { configurable: true, value: () => undefined },
  });
});

function editor(
  onCommit = vi.fn(),
  overrides: Partial<React.ComponentProps<typeof FinalRequestAssertionEditor>> = {},
) {
  return {
    onCommit,
    ...render(
      <FinalRequestAssertionEditor
        sources={[SOURCE]}
        lotIds={["cargo_line:lot-1"]}
        quotationVersionIds={["quote-version-1"]}
        initialAssertions={[]}
        busy={false}
        onCommit={onCommit}
        {...overrides}
      />,
    ),
  };
}

async function choose(user: ReturnType<typeof userEvent.setup>, name: RegExp, option: RegExp) {
  await user.click(screen.getByRole("combobox", { name }));
  await user.click(screen.getByRole("option", { name: option }));
}

describe("FinalRequestAssertionEditor P1-C2 typé", () => {
  it("reste entièrement manuel au montage", () => {
    const onCommit = vi.fn();
    editor(onCommit);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(/sans extraction automatique ni pricing/i))
      .toBeInTheDocument();
  });

  it("construit une valeur numérique typée depuis l'ID de source versionnée", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    editor(onCommit);
    await choose(user, /Information concernée/i, /Poids total/i);
    await user.type(
      screen.getByRole("textbox", { name: /Valeur confirmée par le client/i }),
      "1200",
    );
    await user.type(
      screen.getByLabelText(/Extrait exact/i),
      "poids total de 1200 kg",
    );
    await user.click(
      screen.getByRole("button", { name: /Ajouter cette instruction/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /Enregistrer cette révision/i }),
    );

    expect(onCommit).toHaveBeenCalledTimes(1);
    const [assertions, key] = onCommit.mock.calls[0];
    expect(key).toMatch(/^frs-ui-commit-/);
    expect(assertions).toHaveLength(1);
    expect(assertions[0]).toMatchObject({
      sourceId: "source-version-1",
      operation: "set",
      scope: "case",
      field: "cargo.weight_kg",
      value: 1200,
      excerpt: "poids total de 1200 kg",
    });
    expect(Object.keys(assertions[0]).sort()).toEqual(
      ["excerpt", "field", "id", "operation", "scope", "sourceId", "value"]
        .sort(),
    );
  });

  it("conserve le brouillon et la même clé lors d'un nouvel essai", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    editor(onCommit);
    await choose(user, /Action explicite/i, /Accusé de réception/i);
    await user.type(screen.getByLabelText(/Extrait exact/i), "Merci");
    await user.click(
      screen.getByRole("button", { name: /Ajouter cette instruction/i }),
    );
    const commit = screen.getByRole("button", {
      name: /Enregistrer cette révision/i,
    });
    await user.click(commit);
    await user.click(commit);
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit.mock.calls[1][1]).toBe(onCommit.mock.calls[0][1]);
    expect(onCommit.mock.calls[1][0]).toEqual(onCommit.mock.calls[0][0]);
  });

  it("refuse toute source non attestée sans proposer de saisie", () => {
    editor(vi.fn(), {
      sources: [{ ...SOURCE, roleVerified: false }],
    });
    expect(screen.getByText(/Aucune source client attestée exploitable/i))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ajouter cette instruction/i }))
      .toBeNull();
  });

  it("réinitialise l'extrait quand la source change", async () => {
    const user = userEvent.setup();
    editor(vi.fn(), {
      sources: [
        { ...SOURCE, id: "email-a-1" },
        {
          ...SOURCE,
          id: "email-b-1",
          text: "Nouvelle instruction distincte du client.",
        },
      ],
    });
    const excerpt = screen.getByLabelText(/Extrait exact/i);
    await user.type(excerpt, "Merci");
    expect(excerpt).toHaveValue("Merci");
    await choose(user, /Source client attestée/i, /email-b-/i);
    expect(excerpt).toHaveValue("");
  });

  it("bloque le chargement intégral d'une révision incohérente", () => {
    editor(vi.fn(), {
      initialAssertions: [{
        id: "ancienne-assertion",
        sourceId: "source-absente",
        scope: "case",
        operation: "acknowledge",
        excerpt: "Merci",
      }],
    });
    expect(screen.getByText(/ne correspond pas à la capture courante/i))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ajouter cette instruction/i }))
      .toBeDisabled();
  });

  it("réinitialise le brouillon quand la capture change", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const ui = render(
      <FinalRequestAssertionEditor
        key="capture-a"
        sources={[SOURCE]}
        lotIds={[]}
        quotationVersionIds={[]}
        initialAssertions={[]}
        busy={false}
        onCommit={onCommit}
      />,
    );
    await choose(user, /Action explicite/i, /Accusé de réception/i);
    await user.type(screen.getByLabelText(/Extrait exact/i), "Merci");
    await user.click(
      screen.getByRole("button", { name: /Ajouter cette instruction/i }),
    );
    expect(screen.getByText(/Brouillon de révision/i)).toBeInTheDocument();

    ui.rerender(
      <FinalRequestAssertionEditor
        key="capture-b"
        sources={[{ ...SOURCE, id: "source-version-2" }]}
        lotIds={[]}
        quotationVersionIds={[]}
        initialAssertions={[]}
        busy={false}
        onCommit={onCommit}
      />,
    );
    expect(screen.queryByText(/Brouillon de révision/i)).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
