import { z } from "zod";

const User = z.object({
  email: z.email(),
  age: z.number().int().min(18),
});

type User = z.infer<typeof User>;

const user = User.parse(req.body); // validated and typed
