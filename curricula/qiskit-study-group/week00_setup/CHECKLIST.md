# Week 00 self-evaluation

Go through this after finishing `lab.ipynb` and attempting `challenge.ipynb`. It is for
you, not for anyone to grade — the point is noticing what actually happened, not
checking boxes for their own sake.

- [ ] `uv sync --locked --extra notebooks` completed without an error.
- [ ] JupyterLab opened, and the kernel selected for `lab.ipynb` is this project's
      `.venv`, not a system or global Python.
- [ ] The setup cell printed a Qiskit version starting with `2.5`, and its assertion
      did not stop the notebook.
- [ ] You can read `qc.draw("text")` output and match it to what `qc.draw("mpl")`
      drew — same circuit, two views.
- [ ] Sampling at `shots=100` and `shots=10000` both produced counts that summed to
      the requested shot count, and both outcomes (`0` and `1`) appeared each time.
- [ ] Both `role=checkpoint` cells in `lab.ipynb` passed without an `AssertionError`.
- [ ] You can say, in your own words and without looking it up, what "local
      statevector" means and how it differs from running on real hardware.
- [ ] You attempted `challenge.ipynb` yourself before opening
      `challenge_solution.ipynb`.

One remaining question: _______________________________________________
