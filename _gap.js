const { newDb } = require('pg-mem');
const mem = newDb();
mem.public.registerFunction({ name:'ceil', args:[{type:mem.public.getType ? undefined : undefined}], returns:undefined, implementation:()=>0 });
