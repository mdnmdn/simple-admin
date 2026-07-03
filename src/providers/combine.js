// combineDataProviders (doc 02 §5.2) — routes each resource to a distinct underlying provider.
// Near-verbatim port of ra-core's Proxy-based implementation; the returned object still exposes
// the same DataProvider method surface, dispatching by the `resource` argument.

export const combineDataProviders = (getDataProvider) =>
  new Proxy(
    {},
    {
      get: (_target, name) => {
        if (typeof name === 'symbol' || name === 'then') return undefined;
        return (resource, params) => {
          const provider = getDataProvider(resource);
          const method = provider[name];
          if (typeof method !== 'function') {
            throw new Error(
              `Unknown dataProvider method '${String(name)}' for resource '${resource}'`
            );
          }
          return method.call(provider, resource, params);
        };
      },
    }
  );

export default combineDataProviders;
