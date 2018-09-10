const MUTABLE = Symbol('MUTABLE')

const isPrimitive = target => {
  switch (typeof target) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'undefined':
      return true
  }
  if (target === null) return true
  return false
}

const isFunction = target => typeof target === 'function'

const isDuplicable = target => !(isPrimitive(target) || isFunction(target))

const isMutable = target => Boolean(target && target[MUTABLE])

const enum ops {
  GET, // read a mutable prop
  SET, // write to a prop
  DEL, // delete prop
  DEF // defineProperty
}

class ProxyWorker {
  records = new Map<any, Array<[ops, any]>>()
  client: any
  proto: any
  constructor(client) {
    this.client = client
    this.proto = Reflect.getPrototypeOf(client)
  }

  query(key) {
    let record = this.records.get(key)
    if (!record) return undefined
    return record[record.length - 1]
  }

  addOp(key, op) {
    const record = this.records.get(key) || []
    record.push(op)
    this.records.set(key, record)
  }

  has(key) {
    const lastOp = this.query(key)
    if (!lastOp) return Reflect.has(this.client, key)
    const [opcode] = lastOp
    if (opcode === ops.DEL) {
      // client has the key but is not ownProperty
      return Reflect.has(this.client, key) && !Reflect.getOwnPropertyDescriptor(this.client, key)
    }
    return true
  }

  hasOwnProperty(key) {
    return Boolean(this.getOwnPropertyDescriptor(key))
  }

  getOwnPropertyDescriptor(key) {
    const lastOp = this.query(key)
    if (lastOp) {
      // @ts-ignore
      const [opcode, desc] = lastOp
      return desc
    } else {
      return Reflect.getOwnPropertyDescriptor(this.client, key)
    }
  }

  ownKeys() {
    const keys = [] as any[]
    const originalKeys = Reflect.ownKeys(this.client)
    originalKeys.forEach(key => {
      if (this.records.has(key)) {
        const [opcode] = this.query(key)!
        if (opcode !== ops.DEL) {
          keys.push(key)
        }
      } else {
        keys.push(key)
      }
    })

    this.records.forEach((v, key) => {
      const lastOp = v[v.length - 1]
      if (lastOp[0] !== ops.DEL) keys.push(key)
    })

    return keys
  }

  defineProperty(key, desc) {
    this.addOp(key, [ops.DEF, desc])
  }

  get(key) {
    const lastOp = this.query(key)
    let value
    if (!lastOp) {
      const desc = Reflect.getOwnPropertyDescriptor(this.client, key)
      if (desc) {
        // has own prop
        value = mutable(this.client[key])
        if (isMutable(value)) {
          if (desc.hasOwnProperty('value')) {
            this.addOp(key, [ops.GET, { ...desc, value }])
          }
        }
      } else {
        value = this.client[key]
      }
    } else {
      // @ts-ignore
      const [opcode, desc] = lastOp
      value = desc.value
    }

    return value
  }

  set(key, value) {
    value = mutable(value)
    const desc = { writable: true, enumerable: true, configurable: true, value }
    this.addOp(key, [ops.SET, desc])
  }

  del(key) {
    const desc = this.getOwnPropertyDescriptor(key)
    if (!desc) return true
    if (desc.configurable) {
      this.addOp(key, [ops.DEL, undefined])
      return true
    } else {
      return false
    }
  }
}

export function getValue(target) {
  if (!isMutable(target)) return target

  const proxyWorker = target[MUTABLE] as ProxyWorker
  const client = proxyWorker.client

  if (!proxyWorker.records.size) return client

  const result = Array.isArray(client) ? [...client] : { ...client }

  let mutated = false
  proxyWorker.records.forEach((record, key) => {
    const lastOps = record[record.length - 1]
    const [opcode, desc] = lastOps
    switch (opcode) {
      case ops.DEL: {
        mutated = true
        delete result[key]
        break
      }
      case ops.DEF: {
        mutated = true
        Object.defineProperty(result, key, desc)
        break
      }
      case ops.GET:
      case ops.SET: {
        const oldValue = client[key]
        const newValue = getValue(desc.value)
        if (oldValue !== newValue) mutated = true
        result[key] = newValue
        break
      }
    }
  })

  if (mutated) return result
  return client
}

export function mutable(target) {
  if (!isDuplicable(target)) return target
  if (isMutable(target)) return target

  const proxyWorker = new ProxyWorker(target)

  // return the facade proxy object, connects traps to proxyWorker's methods
  return new Proxy(target, {
    // read
    get(target, key) {
      if (key === MUTABLE) return proxyWorker
      return proxyWorker.get(key)
    },

    // mutate
    set(target, key, value) {
      proxyWorker.set(key, value)
      return true
    },

    // mutate
    defineProperty(target, key, desc) {
      const oldDesc = proxyWorker.getOwnPropertyDescriptor(key)
      if (!oldDesc.configurable) return false
      proxyWorker.defineProperty(key, desc)
      return true
    },

    // read
    getOwnPropertyDescriptor(target, key) {
      return proxyWorker.getOwnPropertyDescriptor(key)
    },

    // read
    has(target, key) {
      return proxyWorker.has(key)
    },

    // read
    ownKeys(target) {
      return proxyWorker.ownKeys()
    },

    // mutate
    deleteProperty(target, key) {
      return proxyWorker.del(key)
    },

    // read
    getPrototypeOf(target) {
      return proxyWorker.proto
    },

    // mutate
    setPrototypeOf(target, proto) {
      proxyWorker.proto = proto
      return true
    },

    preventExtensions(target) {
      return false
    },

    isExtensible(target) {
      return true
    }
  })
}
