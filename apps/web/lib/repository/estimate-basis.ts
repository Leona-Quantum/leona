// The estimate vocabulary, alone in its own module so both a server module and
// a client component can import it without either pulling in the other's
// dependencies. Mirrors majorana_contracts.ResourceEstimateBasis.
//
// Four values because there are four different things the page can be saying,
// and any pair of them collapsed together is how an estimate starts reading as
// a measurement:
//
//   exact       counted from a closed vocabulary; no approximation anywhere
//   estimated   real under a stated synthesis precision, and moves with it
//   refused     an operation this stack cannot name, so there is no number
//   no_circuit  nothing to cost; nothing was attempted and nothing failed
//
// `refused` and `no_circuit` are kept apart deliberately. 163 of the 283
// published entries are literature and operator records with no circuit, and
// showing those as refusals would invent a doubt about them that the data does
// not support.
export const PUBLIC_ESTIMATE_BASES = ["exact", "estimated", "refused", "no_circuit"] as const;

export type ResourceEstimateBasis = (typeof PUBLIC_ESTIMATE_BASES)[number];
