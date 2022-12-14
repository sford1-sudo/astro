import { useState } from 'preact/hooks';

/** a counter written in Preact */
function PreactCounter({ children, id }) {
	const [count, setCount] = useState(0);
	const add = () => setCount((i) => i + 1);
	const subtract = () => setCount((i) => i - 1);

	return (
		<div id={id} class="counter">
			<button class="decrement" onClick={subtract}>-</button>
			<pre>{count}</pre>
			<button class="increment" onClick={add}>+</button>
			<div class="children">{children}</div>
		</div>
	);
}

export const components = { PreactCounter }
