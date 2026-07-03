// withLifecycleCallbacks (doc 02 §5.1) — injects before/after hooks per resource without
// touching the base provider. Each handler entry targets a `resource` (or '*' for all) and may
// define before<Method>/after<Method> for any of the 9 core methods. before hooks receive
// (params, dataProvider, resource) and return (possibly modified) params; after hooks receive
// (result, dataProvider, resource) and return (possibly modified) result. Hooks chain in order.

const CORE_METHODS = [
  'getList',
  'getOne',
  'getMany',
  'getManyReference',
  'create',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
];

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const withLifecycleCallbacks = (dataProvider, callbacks = []) => {
  const handlers = Array.isArray(callbacks) ? callbacks : [callbacks];
  const matching = (resource) =>
    handlers.filter((h) => h && (h.resource === resource || h.resource === '*'));

  const wrapped = { ...dataProvider };

  for (const method of CORE_METHODS) {
    if (typeof dataProvider[method] !== 'function') continue;
    const beforeKey = `before${capitalize(method)}`;
    const afterKey = `after${capitalize(method)}`;

    wrapped[method] = async (resource, params) => {
      const applicable = matching(resource);

      let nextParams = params;
      for (const handler of applicable) {
        if (typeof handler[beforeKey] === 'function') {
          nextParams = await handler[beforeKey](nextParams, dataProvider, resource);
        }
      }

      let result = await dataProvider[method](resource, nextParams);

      for (const handler of applicable) {
        if (typeof handler[afterKey] === 'function') {
          result = await handler[afterKey](result, dataProvider, resource);
        }
      }
      return result;
    };
  }

  return wrapped;
};

export default withLifecycleCallbacks;
