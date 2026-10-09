# Structured result schemas

`output.schema` (HTTP) and `output_schema` (MCP) accept a bounded subset of JSON Schema 2020-12. Unsupported or malformed schemas are rejected with the keyword and location. The same check runs when validating results for an existing job: an older unsupported schema produces a visible validation error, never a successful validation result.

The subset preserves the research/demo schemas shipped with Hitchhike: objects, required fields, arrays of objects, strings, integers and minimum array lengths.

| Supported keyword | Contract |
| --- | --- |
| `type` | A JSON type, or a nonempty list of distinct types; `integer` is supported. |
| `properties`, `required` | At most 200 properties or distinct required names per object schema. Required names refer to the data object's own properties. |
| `additionalProperties` | A schema or boolean. |
| `items` | A schema or boolean for array items after any `prefixItems`. Draft-style tuple arrays in `items` are unsupported. |
| `prefixItems` | A nonempty list of at most 100 schemas or booleans. |
| `enum`, `const` | Scalar JSON values only: strings, finite numbers, booleans or null. An enum contains 1–64 distinct values. |
| `minLength`, `maxLength` | Nonnegative safe integers; lengths count Unicode code points. |
| `minItems`, `maxItems`, `minProperties`, `maxProperties` | Nonnegative safe integers. |
| `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum` | Finite numeric bounds. |
| `title`, `description`, `$comment` | String annotations. |
| `default`, `examples` | Inert JSON annotations; `examples` must be an array. They do not insert defaults or validate examples. |
| `readOnly`, `writeOnly`, `deprecated` | Inert boolean annotations. |
| `$schema` | If present, exactly `https://json-schema.org/draft/2020-12/schema`. |

The top-level schema must be an object; nested boolean schemas are supported. `{}` accepts any JSON value within the validation limits.

All other keywords are rejected, including regexes (`pattern`, `patternProperties`), `format`, references and identifiers, definitions, combinators (`allOf`, `anyOf`, `oneOf`, `not`), conditional schemas, `contains`, `uniqueItems`, dependency/unevaluated keywords and `multipleOf`. Unknown keywords are rejected so a misspelling cannot silently remove a constraint. Use explicit object/array structure, type unions, scalar enums, numeric/length bounds and the task's prose acceptance criteria instead.

Schemas are limited to 32 KiB of serialized UTF-8 JSON, 4,096 JSON values, raw JSON nesting depth 48, 256 schema nodes and schema nesting depth 16 (root depth is zero). Structured data is limited to 20,000 JSON values, nesting depth 64 and 512 KiB of string/key characters; transport body limits still apply independently. These data limits apply to every result, including jobs without an output schema and failure/question envelopes. They are hard admission limits and cannot be bypassed by using up the validation retry allowance. Job `inputs` use the same node/depth limits with a 64 KiB character budget and the existing 64 KB serialized limit, checked before stringification. JSON values here include each object, array and primitive; property names contribute to the character budget. Validation stops after 100,000 structural/enum checks or six reported errors. A limit or internal validation failure is never accepted as proof that the data satisfies the schema.

Legacy structured values are checked again before display. Values outside the safe shape/depth/volume limits appear as an explicit `display_error` JSON object. Safe values are rendered within 512 KiB; indentation is estimated before allocation, with compact JSON used if the pretty form would exceed 64 KiB. This avoids expanding a few kilobytes of nested JSON into megabytes of indentation.

These limits bound schema execution independently of request size. The general-purpose JSON Schema library remains in use for the relay's own fixed MCP tool schemas; caller-supplied output schemas never execute through it.

Run the offline regressions with `node scripts/parser-security-unit.mjs`. Adversarial headings, fences, links, schema features and JSON rendering execute in separate processes with a two-second termination deadline.
