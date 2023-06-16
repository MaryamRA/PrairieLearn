import numpy as np
import numpy.linalg as la


def generate(data):

    candidates = ["\\sin(x)", "\\cos(x)", "x"] + ["x^{}".format(i) for i in range(2, 7)]

    # having different number of data points and parameters for different variants
    m = np.random.randint(5, 12)
    max_n = min(m, len(candidates))  # n cannot be more than this number
    n = np.random.randint(max_n - 2, max_n)
    diff = m - n

    # generating x with potentially duplicating entries
    num_duplicates = np.random.randint(max(diff - 5, 0), diff)
    x = np.random.randint(10, 25, size=(m - num_duplicates))
    # intentionally creating duplicating entries
    x = np.r_[x, [x[-1]] * num_duplicates]
    # shuffling the entries
    np.random.shuffle(x)
    num_unique = len(np.unique(x))
    x = x.astype(float) / 2

    y = np.random.uniform(20, size=m)

    data["params"]["m"] = m
    data["params"]["cm"] = "c" * m
    data["params"]["x"] = " & ".join(map(str, x))
    data["params"]["y"] = " & ".join(map(lambda yi: str(round(yi, 2)), y))

    data["correct_answers"]["rank"] = num_unique
