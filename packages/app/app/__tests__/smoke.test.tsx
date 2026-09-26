import { render, screen } from "@testing-library/react-native";
import Index from "../index";

test("the app renders its first screen", async () => {
  await render(<Index />);
  expect(screen.getByText("SchoolSoft")).toBeTruthy();
});
