"""Published error figures behind Studio's "before you pay" noise estimate.

Every number here was read by hand from the page named beside it, on the date
beside it, and `published_as` repeats the figure as that page printed it. A
figure the page did not publish is None, never a typical value for the
technology: the estimate leaves an absent figure out and the UI says it did,
which understates the noise, but it understates it visibly. A filled-in
guess would do the same thing invisibly.

Three limits, all stated to the user in the preview:

- These are vendor summaries (a median, a mean, or one headline figure), not
  the calibration of the machine on the day a job runs.
- Readout error is published only by IBM and IonQ. IonQ's figure is SPAM
  (state preparation and measurement together), which the estimate treats as
  a readout error. That slightly overstates readout alone.
- IBM's public listing publishes a median two-qubit error and a median readout
  error per machine, but no one-qubit figure. The per-machine calibration page
  that has one needs a sign-in, and reading it with a user's credential is a
  separate, later increment (proposal 5, increment 3's gate note).

IBM figures are a snapshot of a live calibration listing, so they drift from
day to day. The date is what makes them honest; refresh all of them together.
"""

from __future__ import annotations

from .models import ErrorStatistic, PublishedErrorFigure, PublishedNoise, PublishedNoiseProfile

READ_ON = "2026-09-22"

IONQ_FORTE_SOURCE = "https://ionq.com/quantum-systems/forte"
AQT_IBEX_SOURCE = "https://www.aqt.eu/products/ibex-q1/"
IQM_GARNET_SOURCE = "https://aws.amazon.com/braket/quantum-computers/iqm/"
IQM_EMERALD_SOURCE = (
    "https://aws.amazon.com/blogs/quantum-computing/"
    "amazon-braket-launches-new-54-qubit-superconducting-quantum-processor-from-iqm/"
)
RIGETTI_SOURCE = "https://www.rigetti.com/what-we-build"
IBM_COMPUTERS_SOURCE = "https://quantum.cloud.ibm.com/computers"


def _figure(
    value: float, statistic: ErrorStatistic, published_as: str, source: str
) -> PublishedErrorFigure:
    return PublishedErrorFigure(
        value=value,
        statistic=statistic,
        published_as=published_as,
        source_url=source,
        read_on=READ_ON,
    )


def _ibm_machine(machine: str, two_qubit: float, readout: float) -> PublishedNoiseProfile:
    # `published_as` names the field in the listing's page data, because the
    # listing renders these numbers client-side and its display rounding is
    # not something this file can promise to match.
    return PublishedNoiseProfile(
        machine=machine,
        two_qubit_gate_error=_figure(
            two_qubit,
            ErrorStatistic.MEDIAN,
            f"two_q_error_median {two_qubit}",
            IBM_COMPUTERS_SOURCE,
        ),
        readout_error=_figure(
            readout, ErrorStatistic.MEDIAN, f"readout_error_median {readout}", IBM_COMPUTERS_SOURCE
        ),
    )


#: IBM Open Plan. The adapter submits to `service.least_busy(...)`, so the
#: machine is IBM's choice at submit time and no single profile describes the
#: run. The candidates are every machine IBM's public listing shows in the
#: us-east region, because the plans overview says Open Plan instances can only
#: be created there (https://quantum.cloud.ibm.com/docs/en/guides/plans-overview,
#: read 2026-09-22). IBM does not publish which of those an Open Plan instance
#: reaches, so this is the widest honest set; a given instance may reach fewer.
#: ibm_aachen and ibm_berlin are listed too, but in eu-de, and are left out.
IBM_OPEN_PLAN_NOISE = PublishedNoise(
    gate_model=True,
    machine_chosen_at_submit=True,
    profiles=(
        _ibm_machine("ibm_boston (Heron r3)", 0.0014144352, 0.00390625),
        _ibm_machine("ibm_fez (Heron r2)", 0.002714275, 0.008850098),
        _ibm_machine("ibm_kingston (Heron r2)", 0.0019666268, 0.0078125),
        _ibm_machine("ibm_marrakesh (Heron r2)", 0.0028019925, 0.011108398),
        _ibm_machine("ibm_miami (Nighthawk r1)", 0.002782349, 0.021240234),
        _ibm_machine("ibm_phoenix (Nighthawk r2)", 0.0016809205, 0.007507324),
        _ibm_machine("ibm_pittsburgh (Heron r3)", 0.001985875, 0.0041503906),
    ),
)

#: AQT's own product page. It publishes register-wide averages from randomized
#: benchmarking, not medians, and no readout figure.
AQT_IBEX_Q1_NOISE = PublishedNoise(
    gate_model=True,
    profiles=(
        PublishedNoiseProfile(
            machine="AQT IBEX-Q1",
            one_qubit_gate_error=_figure(
                3.4e-4,
                ErrorStatistic.MEAN,
                "Avg. single-qubit errors (3,4 +/- 1,0)E-4",
                AQT_IBEX_SOURCE,
            ),
            two_qubit_gate_error=_figure(
                1.3e-2,
                ErrorStatistic.MEAN,
                "Avg. two-qubit errors (1,3 +/- 0,3)E-2",
                AQT_IBEX_SOURCE,
            ),
        ),
    ),
)

#: IonQ's Forte page. Braket offers two Forte machines (Forte-1 and
#: Forte-Enterprise-1); the page describes Forte as a system and names no
#: statistic, hence STATED.
IONQ_FORTE_NOISE = PublishedNoise(
    gate_model=True,
    profiles=(
        PublishedNoiseProfile(
            machine="IonQ Forte",
            one_qubit_gate_error=_figure(
                2e-4, ErrorStatistic.STATED, "0.02% One-Qubit gate error", IONQ_FORTE_SOURCE
            ),
            two_qubit_gate_error=_figure(
                4e-3, ErrorStatistic.STATED, "0.4% 2-Qubit gate error", IONQ_FORTE_SOURCE
            ),
            readout_error=_figure(
                5e-3, ErrorStatistic.STATED, "0.5% SPAM error", IONQ_FORTE_SOURCE
            ),
        ),
    ),
)

#: AWS's launch post for Emerald calls these "early characterization data".
#: IQM's own QPU page (https://iqm.tech/technology/qpu/, read 2026-09-22) gives
#: the same two medians for its 54-qubit processor. No readout figure on either.
IQM_EMERALD_NOISE = PublishedNoise(
    gate_model=True,
    profiles=(
        PublishedNoiseProfile(
            machine="IQM Emerald",
            one_qubit_gate_error=_figure(
                7e-4,
                ErrorStatistic.MEDIAN,
                "median single-qubit gate fidelity of 99.93%",
                IQM_EMERALD_SOURCE,
            ),
            two_qubit_gate_error=_figure(
                5e-3,
                ErrorStatistic.MEDIAN,
                "median two-qubit gate fidelity of 99.5%",
                IQM_EMERALD_SOURCE,
            ),
        ),
    ),
)

IQM_GARNET_NOISE = PublishedNoise(
    gate_model=True,
    profiles=(
        PublishedNoiseProfile(
            machine="IQM Garnet",
            one_qubit_gate_error=_figure(
                8e-4,
                ErrorStatistic.MEDIAN,
                "median 1-qubit gate fidelity of 99.92%",
                IQM_GARNET_SOURCE,
            ),
            two_qubit_gate_error=_figure(
                4.9e-3,
                ErrorStatistic.MEDIAN,
                "median 2-qubit gate fidelity of 99.51%",
                IQM_GARNET_SOURCE,
            ),
        ),
    ),
)

#: Aquila runs analog Hamiltonian simulation, not gate circuits (the Braket
#: device list gives its paradigm as "Analog Hamiltonian Simulation",
#: https://docs.aws.amazon.com/braket/latest/developerguide/braket-devices.html,
#: read 2026-09-22). A gate-error estimate for it would be a number about
#: nothing.
QUERA_AQUILA_NOISE = PublishedNoise(gate_model=False)

#: The only Cepheus on Braket is Cepheus-1-108Q (Braket device list, read
#: 2026-09-22). Rigetti's page lists 36- and 108-qubit Cepheus machines with
#: different medians, so the 108-qubit row is the one recorded. No readout figure.
RIGETTI_CEPHEUS_NOISE = PublishedNoise(
    gate_model=True,
    profiles=(
        PublishedNoiseProfile(
            machine="Rigetti Cepheus-1-108Q",
            one_qubit_gate_error=_figure(
                1e-3, ErrorStatistic.MEDIAN, "Single-qubit gates 99.9%", RIGETTI_SOURCE
            ),
            two_qubit_gate_error=_figure(
                9e-3, ErrorStatistic.MEDIAN, "Two-qubit gates (CZ) 99.1%", RIGETTI_SOURCE
            ),
        ),
    ),
)
