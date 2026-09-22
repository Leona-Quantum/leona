/**
 * Which of Studio's CPU runs may still touch the page.
 *
 * A CPU run answers later (the simulation runs in the simulator worker,
 * simulator-client.ts), and by the time it does the reader may have opened
 * another artifact. Everything the run does after its answer — saving the
 * record, adding it to the list, clearing the "run again?" prompt, the
 * "recorded" message, releasing the Run button — belongs to the artifact it
 * was started on, and none of it may land on the one now on screen.
 *
 * Studio holds one `CpuRunSlot`. A run takes a ticket for its artifact; the
 * slot holds one ticket at a time, which is also what stops a second press of
 * Run (or its shortcut) from starting a second run before the first has
 * rendered as busy. When a different artifact is shown, the run for the old
 * one is abandoned: its ticket stops owning the page, and Studio withdraws its
 * job from the simulator. The slot is plain state with no React or browser
 * API in it, so the rules are tested in Node (studio-cpu-run.test.ts).
 */

export type CpuRunTicket = { readonly id: number; readonly artifactId: string };

export class CpuRunSlot {
  #current: CpuRunTicket | null = null;
  #nextId = 1;

  /** Whether a run holds the slot. */
  busy(): boolean {
    return this.#current !== null;
  }

  /** A ticket for a new run on `artifactId`, or null while another run holds the slot. */
  begin(artifactId: string): CpuRunTicket | null {
    if (this.#current) return null;
    const ticket = { id: this.#nextId, artifactId };
    this.#nextId += 1;
    this.#current = ticket;
    return ticket;
  }

  /**
   * Whether `ticket`'s answer may still change the page: it is the run in the
   * slot AND its artifact is the one on screen now. The second half is not
   * redundant with `show`: React renders the new artifact before its effects
   * run, and an answer can arrive in between.
   */
  owns(ticket: CpuRunTicket, shownArtifactId: string | null): boolean {
    return this.#current === ticket && ticket.artifactId === shownArtifactId;
  }

  /** Frees the slot if `ticket` still holds it. True when it did, which is
   * when the caller may release the busy state it set. */
  end(ticket: CpuRunTicket): boolean {
    if (this.#current !== ticket) return false;
    this.#current = null;
    return true;
  }

  /**
   * The artifact on screen is now `artifactId` (null: none, or Studio has
   * gone). A run for any other artifact is abandoned and returned, so the
   * caller can withdraw its job and release the busy state; the same
   * artifact shown again abandons nothing.
   */
  show(artifactId: string | null): CpuRunTicket | null {
    const current = this.#current;
    if (!current || current.artifactId === artifactId) return null;
    this.#current = null;
    return current;
  }
}
