import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ConnectionProvider } from "../../connection/context";
import { memoryStorage, readConnection } from "../../connection/store";
import { DevConnect } from "../DevConnect";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: mockReplace }) }));

async function setup() {
  const storage = memoryStorage();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ConnectionProvider
      storage={{ storage, persistent: true }}
      origin="http://localhost:8080"
      language="en"
    >
      {children}
    </ConnectionProvider>
  );
  await render(<DevConnect />, { wrapper });
  return storage;
}

test("shows the console command and the rotation warning", async () => {
  await setup();
  expect(screen.getByText(/sessionStorage.getItem\("schoolsoft-reference"\)/)).toBeTruthy();
  expect(screen.getByText(/Close the reference page tab/)).toBeTruthy();
});

test("validates both fields before saving", async () => {
  const storage = await setup();
  await fireEvent.press(screen.getByText("Connect"));
  expect(screen.getByText("Paste the client ID (no spaces).")).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText("Client ID"), "cid");
  await fireEvent.press(screen.getByText("Connect"));
  expect(screen.getByText("Paste the refresh token.")).toBeTruthy();
  expect(readConnection(storage)).toBeUndefined();
});

test("saves and goes to the children list", async () => {
  const storage = await setup();
  await fireEvent.changeText(screen.getByLabelText("Client ID"), "cid");
  await fireEvent.changeText(screen.getByLabelText("Refresh token"), "rt");
  await fireEvent.press(screen.getByText("Connect"));
  expect(readConnection(storage)).toMatchObject({
    clientId: "cid",
    tokens: { refreshToken: "rt", expiresAt: 0 },
  });
  expect(mockReplace).toHaveBeenCalledWith("/");
});
