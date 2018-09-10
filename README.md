# as-mutable

`as-mutable` offers an ergonomic way to mutate data without touching the original source. It's a handy helper at circumstance, say when you work with `redux`, where you need to mutate native js data struct (object/array) while keeping the original source immutable.

## Usage

```js
import { asMutable, getValue } from 'as-mutable'

const mutableCopy = asMutable(source)
// do whatever you want to the `mutableCopy`,
// mutate it! it's ok as long as you keep its reference.

// own prop:
mutableCopy.foo = 'bar'
// deep nested object
mutableCopy.zoo.lo = 'gy'
// deep nested array
mutableCopy.things.push({ useful: true })
// new prop
mutableCopy.usefulThings = mutableCopy.things.filter(item => item.useful)

// when you're done, call `getValue()` to get the result.
const result = getValue(mutableCopy)
```

## Caveats

1. In order to work, `as-mutable` requires present of ES `Proxy` in the runtime.
2. It's designed for plain js object and array, object with custom prototype should be fine most of the time, supposing you don't do crazy things.
3. No support for ES Map/Set/WeekMap. These data structs are meant to be mutable at source, don't see the point to keep them immutable.
