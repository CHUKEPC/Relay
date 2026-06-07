import { describe, expect, it } from 'vitest'
import { parseProto, reflectServices } from './index'

const SAMPLE = `
syntax = "proto3";
package helloworld;

message HelloRequest { string name = 1; }
message HelloReply { string message = 1; }

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
  rpc LotsOfReplies (HelloRequest) returns (stream HelloReply);
  rpc LotsOfGreetings (stream HelloRequest) returns (HelloReply);
  rpc BidiHello (stream HelloRequest) returns (stream HelloReply);
}
`

describe('gRPC parseProto', () => {
  it('lists services and methods with the right streaming kinds', () => {
    const res = parseProto(SAMPLE)
    expect(res.error).toBeUndefined()
    expect(res.services).toHaveLength(1)
    const svc = res.services[0]
    expect(svc.name).toBe('helloworld.Greeter')
    const byName = Object.fromEntries(svc.methods.map((m) => [m.name, m]))
    expect(byName.SayHello.kind).toBe('unary')
    expect(byName.LotsOfReplies.kind).toBe('server_stream')
    expect(byName.LotsOfGreetings.kind).toBe('client_stream')
    expect(byName.BidiHello.kind).toBe('bidi')
    expect(byName.SayHello.path).toBe('/helloworld.Greeter/SayHello')
  })

  it('reports a clear error for a proto with no service', () => {
    const res = parseProto('syntax = "proto3"; message A { string a = 1; }')
    expect(res.services).toHaveLength(0)
    expect(res.error).toBeTruthy()
  })

  it('reports a parse error for invalid proto', () => {
    const res = parseProto('this is not valid proto')
    expect(res.error).toBeTruthy()
  })

  it('handles empty input', () => {
    const res = parseProto('   ')
    expect(res.services).toHaveLength(0)
    expect(res.error).toBeTruthy()
  })
})

describe('gRPC reflectServices', () => {
  it('returns a structured error for an unreachable address (no throw)', async () => {
    // Port 1 is reserved/closed: the dial fails fast and we should resolve with
    // an error result rather than throwing or hanging.
    const res = await reflectServices({ address: '127.0.0.1:1', metadata: [], plaintext: true })
    expect(res.services).toHaveLength(0)
    expect(res.error).toBeTruthy()
  }, 20000)
})
