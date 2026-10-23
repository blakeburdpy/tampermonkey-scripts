# Tampermonkey scripts
## Canvas Universal Rubric Max Scorer

**Version:** 3.5  
**Platform:** Canvas LMS (SpeedGrader)  
**Requirements:** Tampermonkey or another compatible userscript manager

### Overview

Canvas Universal Rubric Max Scorer is a browser userscript designed to streamline rubric scoring within Canvas SpeedGrader.

The script provides rubric scoring assistance, save verification, navigation features, and diagnostic functionality to support more efficient grading workflows.

### Installation

1. Install Tampermonkey in your browser.
2. Open the `Canvas Universal Rubric Max Scorer.user.js` file in this repository.
3. Select **Raw** to view the script's source.
4. Install the script through Tampermonkey.
5. Open a Canvas assignment in SpeedGrader to use it.

### Domain compatibility

The script is currently configured for Canvas installations using `*.instructure.com` domains.

Its default URL matching rule is:

```javascript
// @match https://*.instructure.com/courses/*/gradebook/speed_grader*
```

**If your institution uses a custom Canvas domain**, modify the `@match` directive in the userscript metadata.

For example:

```javascript
// @match https://canvas.example.edu/courses/*/gradebook/speed_grader*
```

Replace `canvas.example.edu` with your institution's actual Canvas hostname.

### Important notes

- This script is an independent utility and is not affiliated with or endorsed by Instructure.
- Canvas interface changes may affect functionality.
- Review rubric scores and confirm that changes have been saved before leaving SpeedGrader.
- The script should be tested in your institution's Canvas environment before relying on it for routine grading.


## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
